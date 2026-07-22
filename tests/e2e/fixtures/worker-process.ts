import type { ChildProcess } from "node:child_process";
import { createServer } from "node:net";

const serverShutdownTimeoutMs = 5_000;
export const serverExitPollIntervalMs = 50;
export const serverListeningMessageType = "grm-e2e-worker-server-listening";

// Next.js registers its own server error handler before calling listen() and
// exits synchronously on EADDRINUSE. A synchronous marker written by a
// prepended listener therefore survives even when an IPC message would not.
export const workerServerBootstrap = `
const fs = require("node:fs");
const net = require("node:net");
const originalListen = net.Server.prototype.listen;
const expectedPort = Number(process.env.E2E_WORKER_PORT);
const collisionMarkerPath = process.env.E2E_WORKER_PORT_COLLISION_PATH;

net.Server.prototype.listen = function (...args) {
  this.prependOnceListener("error", (error) => {
    if (error?.code === "EADDRINUSE" && collisionMarkerPath) {
      fs.writeFileSync(collisionMarkerPath, String(expectedPort));
    }
  });
  this.once("listening", () => {
    const address = this.address();
    if (address && typeof address === "object" && address.port === expectedPort) {
      process.send?.({ type: "${serverListeningMessageType}", port: expectedPort });
    }
  });
  return originalListen.apply(this, args);
};

require(process.env.E2E_WORKER_SERVER_ENTRY);
`;

export class PortCollisionError extends Error {
  override name = "PortCollisionError";
}

export async function runWithPortCollisionRetries<T>(
  runAttempt: () => Promise<T>,
  maxAttempts = 3,
): Promise<T> {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError("maxAttempts must be a positive integer.");
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await runAttempt();
    } catch (error) {
      if (!(error instanceof PortCollisionError) || attempt === maxAttempts) {
        throw error;
      }
    }
  }

  throw new Error("Port collision retry loop ended unexpectedly.");
}

export function hasServerExited(serverProcess: ChildProcess): boolean {
  return serverProcess.exitCode !== null || serverProcess.signalCode !== null;
}

export function serverExitMessage(serverProcess: ChildProcess): string {
  if (serverProcess.exitCode !== null) {
    return `exit code ${serverProcess.exitCode}`;
  }
  if (serverProcess.signalCode !== null) {
    return `signal ${serverProcess.signalCode}`;
  }
  return "an unknown reason";
}

export async function getAvailablePort(): Promise<number> {
  const reservation = createServer();
  reservation.unref();

  return new Promise<number>((resolve, reject) => {
    reservation.once("error", reject);
    // Match the address used by the standalone server. Reserving only the
    // loopback interface would not detect a port occupied on another address.
    reservation.listen(0, "0.0.0.0", () => {
      const address = reservation.address();
      if (!address || typeof address === "string") {
        reservation.close();
        reject(new Error("Unable to reserve a worker server port."));
        return;
      }

      const { port } = address;
      reservation.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

export async function stopServer(serverProcess: ChildProcess): Promise<void> {
  if (hasServerExited(serverProcess)) {
    return;
  }

  serverProcess.kill("SIGTERM");
  const gracefulDeadline = Date.now() + serverShutdownTimeoutMs;
  while (!hasServerExited(serverProcess) && Date.now() < gracefulDeadline) {
    await new Promise((resolve) =>
      setTimeout(resolve, serverExitPollIntervalMs),
    );
  }

  if (hasServerExited(serverProcess)) {
    return;
  }

  serverProcess.kill("SIGKILL");
  const forcedDeadline = Date.now() + serverShutdownTimeoutMs;
  while (!hasServerExited(serverProcess) && Date.now() < forcedDeadline) {
    await new Promise((resolve) =>
      setTimeout(resolve, serverExitPollIntervalMs),
    );
  }

  if (!hasServerExited(serverProcess)) {
    throw new Error("Worker server did not stop after SIGTERM and SIGKILL.");
  }
}
