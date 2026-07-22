import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test as base } from "@playwright/test";
import {
  getAvailablePort,
  hasServerExited,
  PortCollisionError,
  runWithPortCollisionRetries,
  serverExitMessage,
  serverExitPollIntervalMs,
  serverListeningMessageType,
  stopServer,
  workerServerBootstrap,
} from "./worker-process";

const serverStartupTimeoutMs = 60_000;
const workerFixtureTimeoutMs = 180_000;
const testIsolationTimeoutMs = 90_000;

type WorkerServer = {
  baseURL: string;
  prepareForTest: () => Promise<void>;
};

type TestFixtures = {
  workerStateIsolation: undefined;
};

type WorkerFixtures = {
  workerServer: WorkerServer;
};

function resolveStandaloneDirectory(): string {
  const candidates = [
    process.env.E2E_SERVER_PATH
      ? path.dirname(process.env.E2E_SERVER_PATH)
      : undefined,
    process.cwd(),
    path.join(process.cwd(), ".next", "standalone"),
  ].filter((candidate): candidate is string => Boolean(candidate));

  const standaloneDirectory = candidates.find((candidate) =>
    existsSync(path.join(candidate, "server.js")),
  );

  if (!standaloneDirectory) {
    throw new Error(
      `Unable to find the standalone server. Checked: ${candidates.map((candidate) => path.join(candidate, "server.js")).join(", ")}`,
    );
  }

  return standaloneDirectory;
}

async function linkDirectory(source: string, destination: string) {
  if (!existsSync(source)) {
    return;
  }
  await fs.symlink(source, destination, "dir");
}

async function prepareWorkerApplication(
  standaloneDirectory: string,
  workerDirectory: string,
): Promise<string> {
  await fs.copyFile(
    path.join(standaloneDirectory, "server.js"),
    path.join(workerDirectory, "server.js"),
  );
  await fs.cp(
    path.join(standaloneDirectory, ".next"),
    path.join(workerDirectory, ".next"),
    { recursive: true },
  );

  const packageJsonPath = path.join(standaloneDirectory, "package.json");
  if (existsSync(packageJsonPath)) {
    await fs.copyFile(
      packageJsonPath,
      path.join(workerDirectory, "package.json"),
    );
  }

  await linkDirectory(
    path.join(standaloneDirectory, "node_modules"),
    path.join(workerDirectory, "node_modules"),
  );

  const publicDirectory = existsSync(path.join(standaloneDirectory, "public"))
    ? path.join(standaloneDirectory, "public")
    : path.join(process.cwd(), "public");
  await linkDirectory(publicDirectory, path.join(workerDirectory, "public"));

  const staticDirectory = path.join(workerDirectory, ".next", "static");
  if (!existsSync(staticDirectory)) {
    await linkDirectory(
      path.join(process.cwd(), ".next", "static"),
      staticDirectory,
    );
  }

  return path.join(workerDirectory, "server.js");
}

async function waitForServer(
  baseURL: string,
  serverProcess: ChildProcess,
  getSpawnError: () => Error | undefined,
  isOwnedPortListening: () => boolean,
  hasPortCollision: () => boolean,
): Promise<void> {
  const deadline = Date.now() + serverStartupTimeoutMs;

  while (Date.now() < deadline) {
    const spawnError = getSpawnError();
    if (spawnError) {
      throw spawnError;
    }
    if (hasPortCollision()) {
      throw new Error(`Worker server could not bind ${baseURL}.`);
    }
    if (hasServerExited(serverProcess)) {
      throw new Error(
        `Worker server exited before becoming ready (${serverExitMessage(serverProcess)}).`,
      );
    }

    if (!isOwnedPortListening()) {
      await new Promise((resolve) =>
        setTimeout(resolve, serverExitPollIntervalMs),
      );
      continue;
    }

    let isReady = false;
    try {
      const response = await fetch(`${baseURL}/api/auth/setup`, {
        headers: { "cache-control": "no-store" },
        signal: AbortSignal.timeout(1_000),
      });
      isReady = response.ok || response.status === 404;
    } catch {
      // The server is still starting.
    }

    if (isReady) {
      if (getSpawnError()) {
        throw getSpawnError();
      }
      if (hasServerExited(serverProcess)) {
        throw new Error(
          `Worker server exited before becoming ready (${serverExitMessage(serverProcess)}).`,
        );
      }
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(
    `Worker server at ${baseURL} did not become ready within ${serverStartupTimeoutMs}ms.`,
  );
}

async function bootstrapWorker(baseURL: string): Promise<void> {
  const setupToken = process.env.AUTH_SETUP_TOKEN || "y".repeat(64);
  const email =
    process.env.AUTH_EMAIL || process.env.AUTH_USERNAME || "test@example.test";
  const username =
    process.env.AUTH_USERNAME || email.split("@")[0] || "testadmin";
  const password = process.env.AUTH_PASSWORD || "TestPassword123";

  const setupStatusResponse = await fetch(`${baseURL}/api/auth/setup`, {
    headers: { "cache-control": "no-store" },
  });
  if (setupStatusResponse.status === 404) {
    return;
  }
  if (!setupStatusResponse.ok) {
    throw new Error(
      `Failed to check worker setup status: GET /api/auth/setup returned ${setupStatusResponse.status}.`,
    );
  }

  const setupResponse = await fetch(`${baseURL}/api/auth/setup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token: setupToken,
      email,
      password,
      name: "E2E Admin",
      username,
    }),
  });
  if (setupResponse.status === 201 || setupResponse.status === 404) {
    return;
  }

  const payload = await setupResponse.text().catch(() => "");
  throw new Error(
    `Failed to bootstrap worker: POST /api/auth/setup returned ${setupResponse.status}${payload ? ` (${payload})` : ""}.`,
  );
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  workerServer: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright requires a destructured fixtures argument.
    async ({}, use, workerInfo) => {
      const configuredBaseURL = process.env.BASE_URL?.replace(/\/$/, "");
      if (configuredBaseURL) {
        // Preserve the previous externally managed, single-server test mode.
        await bootstrapWorker(configuredBaseURL);
        await use({
          baseURL: configuredBaseURL,
          prepareForTest: async () => {},
        });
        return;
      }

      const standaloneDirectory = resolveStandaloneDirectory();
      const workerDirectory = await fs.mkdtemp(
        path.join(os.tmpdir(), `grm-e2e-worker-${workerInfo.parallelIndex}-`),
      );
      let logFile: Awaited<ReturnType<typeof fs.open>> | undefined;
      let serverProcess: ChildProcess | undefined;
      let baseURL = "";

      try {
        const serverEntryPath = await prepareWorkerApplication(
          standaloneDirectory,
          workerDirectory,
        );
        const outputDirectory = workerInfo.project.outputDir;
        await fs.mkdir(outputDirectory, { recursive: true });
        const logPath = path.join(
          outputDirectory,
          `worker-${workerInfo.parallelIndex}-server.log`,
        );
        logFile = await fs.open(logPath, "a");
        const setupToken = process.env.AUTH_SETUP_TOKEN || "y".repeat(64);
        const dataDirectory = path.join(workerDirectory, "data");
        const baselineDirectory = path.join(workerDirectory, ".baseline-data");

        const startServer = async (bootstrap: boolean) => {
          if (!logFile) {
            throw new Error("Worker server log is not open.");
          }
          const activeLogFile = logFile;
          try {
            await runWithPortCollisionRetries(async () => {
              // Allocate immediately before spawn to keep the unreserved
              // interval as short as possible. IPC proves socket ownership;
              // the marker handles a process that loses the remaining race.
              const port = await getAvailablePort();
              const serverBaseURL = `http://localhost:${port}`;
              const collisionMarkerPath = path.join(
                workerDirectory,
                `.port-collision-${port}`,
              );
              await fs.rm(collisionMarkerPath, { force: true });
              baseURL = serverBaseURL;
              serverProcess = spawn(
                process.execPath,
                ["-e", workerServerBootstrap],
                {
                  cwd: workerDirectory,
                  env: {
                    ...process.env,
                    AUTH_SETUP_TOKEN: setupToken,
                    BACKGROUND_POLLING_INITIALIZED: "true",
                    BETTER_AUTH_SECRET:
                      process.env.BETTER_AUTH_SECRET || "x".repeat(64),
                    BETTER_AUTH_URL: serverBaseURL,
                    E2E_WORKER_PORT: String(port),
                    E2E_WORKER_PORT_COLLISION_PATH: collisionMarkerPath,
                    E2E_WORKER_SERVER_ENTRY: serverEntryPath,
                    GITLAB_ADDITIONAL_HOSTS:
                      process.env.GITLAB_ADDITIONAL_HOSTS || "gitlab.self.test",
                    HOSTNAME: "0.0.0.0",
                    HTTPS: "false",
                    NEXT_TELEMETRY_DISABLED: "1",
                    NODE_ENV: "production",
                    PORT: String(port),
                  },
                  stdio: ["ignore", activeLogFile.fd, activeLogFile.fd, "ipc"],
                },
              );
              const processForAttempt = serverProcess;
              let spawnError: Error | undefined;
              let ownedPortIsListening = false;
              processForAttempt.once("error", (error) => {
                spawnError = error;
              });
              processForAttempt.on("message", (message) => {
                if (
                  typeof message === "object" &&
                  message !== null &&
                  "type" in message &&
                  "port" in message &&
                  message.type === serverListeningMessageType &&
                  message.port === port
                ) {
                  ownedPortIsListening = true;
                }
              });

              try {
                await waitForServer(
                  serverBaseURL,
                  processForAttempt,
                  () => spawnError,
                  () => ownedPortIsListening,
                  () => existsSync(collisionMarkerPath),
                );
                if (bootstrap) {
                  await bootstrapWorker(serverBaseURL);
                }
              } catch (error) {
                if (!existsSync(collisionMarkerPath)) {
                  throw error;
                }

                await stopServer(processForAttempt);
                if (serverProcess === processForAttempt) {
                  serverProcess = undefined;
                }
                throw new PortCollisionError(
                  `Worker server could not bind ${serverBaseURL}.`,
                );
              }
            });
          } catch (error) {
            const serverLog = await fs
              .readFile(logPath, "utf8")
              .catch(() => "");
            throw new Error(
              `${error instanceof Error ? error.message : String(error)}${
                serverLog ? `\nWorker server log:\n${serverLog}` : ""
              }`,
            );
          }
        };

        const stopCurrentServer = async () => {
          if (!serverProcess) {
            return;
          }
          const processToStop = serverProcess;
          await stopServer(processToStop);
          if (serverProcess === processToStop) {
            serverProcess = undefined;
          }
        };

        await startServer(true);
        await stopCurrentServer();
        // Snapshot the bootstrapped admin database while SQLite is closed.
        if (existsSync(dataDirectory)) {
          await fs.cp(dataDirectory, baselineDirectory, { recursive: true });
        } else {
          await fs.mkdir(baselineDirectory, { recursive: true });
        }
        await startServer(false);

        let isFirstTest = true;
        await use({
          get baseURL() {
            return baseURL;
          },
          prepareForTest: async () => {
            if (isFirstTest) {
              isFirstTest = false;
              return;
            }

            await stopCurrentServer();
            // Restarting also clears module-level storage caches between tests.
            await fs.rm(dataDirectory, { recursive: true, force: true });
            await fs.cp(baselineDirectory, dataDirectory, { recursive: true });
            await startServer(false);
          },
        });
      } finally {
        try {
          if (serverProcess) {
            await stopServer(serverProcess);
          }
        } finally {
          try {
            await logFile?.close();
          } finally {
            await fs.rm(workerDirectory, { recursive: true, force: true });
          }
        }
      }
    },
    { scope: "worker", timeout: workerFixtureTimeoutMs },
  ],

  workerStateIsolation: [
    async ({ workerServer }, use) => {
      await workerServer.prepareForTest();
      await use(undefined);
    },
    { auto: true, timeout: testIsolationTimeoutMs },
  ],

  baseURL: async ({ workerServer, workerStateIsolation }, use) => {
    // Keep the URL lookup ordered after the reset, because every restart gets
    // a fresh dynamically allocated port.
    void workerStateIsolation;
    await use(workerServer.baseURL);
  },
});

export * from "@playwright/test";
