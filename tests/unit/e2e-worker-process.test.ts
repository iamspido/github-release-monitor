// vitest globals enabled

import { spawn } from "node:child_process";
import { once } from "node:events";
import { promises as fs } from "node:fs";
import { createServer, type Server } from "node:net";
import os from "node:os";
import path from "node:path";
import {
  getAvailablePort,
  PortCollisionError,
  runWithPortCollisionRetries,
  stopServer,
  workerServerBootstrap,
} from "../e2e/fixtures/worker-process";

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

describe("E2E worker process lifecycle", () => {
  it("returns immediately when the server already exited by signal", async () => {
    const serverProcess = spawn(process.execPath, [
      "-e",
      "setInterval(() => {}, 1000)",
    ]);
    await once(serverProcess, "spawn");
    const exited = once(serverProcess, "exit");
    serverProcess.kill("SIGTERM");
    await exited;

    expect(serverProcess.exitCode).toBeNull();
    expect(serverProcess.signalCode).toBe("SIGTERM");
    await expect(stopServer(serverProcess)).resolves.toBeUndefined();
  });

  it("stops a running server and returns a valid dynamic port", async () => {
    const port = await getAvailablePort();
    expect(Number.isInteger(port)).toBe(true);
    expect(port).toBeGreaterThan(0);
    expect(port).toBeLessThanOrEqual(65_535);

    const serverProcess = spawn(process.execPath, [
      "-e",
      "setInterval(() => {}, 1000)",
    ]);
    await once(serverProcess, "spawn");
    await stopServer(serverProcess);

    expect(serverProcess.signalCode).toBe("SIGTERM");
  });

  it("retries a port collision and returns the next successful result", async () => {
    let attempts = 0;
    const result = await runWithPortCollisionRetries(async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new PortCollisionError("occupied");
      }
      return "ready";
    });

    expect(result).toBe("ready");
    expect(attempts).toBe(2);
  });

  it("records EADDRINUSE synchronously before the server exits", async () => {
    const tempDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), "grm-e2e-port-collision-"),
    );
    const serverEntryPath = path.join(tempDirectory, "server-entry.cjs");
    const collisionMarkerPath = path.join(tempDirectory, "collision");
    const reservation = createServer();
    let childProcess: ReturnType<typeof spawn> | undefined;

    try {
      await new Promise<void>((resolve, reject) => {
        reservation.once("error", reject);
        reservation.listen(0, "0.0.0.0", resolve);
      });
      const address = reservation.address();
      if (!address || typeof address === "string") {
        throw new Error("Unable to determine reserved test port.");
      }

      await fs.writeFile(
        serverEntryPath,
        `
const net = require("node:net");
const server = net.createServer();
server.on("error", () => process.exit(1));
server.listen(Number(process.env.PORT), process.env.HOSTNAME);
`,
      );
      childProcess = spawn(process.execPath, ["-e", workerServerBootstrap], {
        env: {
          ...process.env,
          E2E_WORKER_PORT: String(address.port),
          E2E_WORKER_PORT_COLLISION_PATH: collisionMarkerPath,
          E2E_WORKER_SERVER_ENTRY: serverEntryPath,
          HOSTNAME: "0.0.0.0",
          PORT: String(address.port),
        },
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      });
      await once(childProcess, "spawn");
      const [exitCode] = await once(childProcess, "exit");

      expect(exitCode).toBe(1);
      await expect(fs.readFile(collisionMarkerPath, "utf8")).resolves.toBe(
        String(address.port),
      );
    } finally {
      if (childProcess) {
        await stopServer(childProcess);
      }
      if (reservation.listening) {
        await closeServer(reservation);
      }
      await fs.rm(tempDirectory, { recursive: true, force: true });
    }
  });
});
