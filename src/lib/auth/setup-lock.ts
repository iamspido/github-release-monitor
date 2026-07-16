import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const dataDirPath = path.join(process.cwd(), "data");
const authSetupLockPath = path.join(dataDirPath, "auth-setup.lock");
const authSetupBootstrapLockPath = path.join(
  dataDirPath,
  "auth-setup-bootstrap.lock",
);
const authSetupBootstrapGatePath = path.join(
  dataDirPath,
  "auth-setup-bootstrap.gate",
);
const authSetupBootstrapLockStaleMs = 10 * 60 * 1_000;
const authSetupBootstrapGateStaleMs = authSetupBootstrapLockStaleMs;
const authSetupBootstrapGateRetryMs = 10;
const authSetupBootstrapGateMaxWaitMs = 5_000;
const authSetupBootstrapGateClaimPrefix = "claim-";

type AuthSetupLockReason = "setup_completed" | "user_exists";

type AuthSetupLockPayload = {
  createdAt: string;
  reason: AuthSetupLockReason;
  email?: string;
  source: string;
};

type AuthSetupBootstrapLockPayload = {
  createdAt: string;
  ownerId?: string;
  source: string;
};

function isNodeErrorWithCode(
  error: unknown,
): error is NodeJS.ErrnoException & { code: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
  );
}

export async function isAuthSetupLocked() {
  try {
    await fs.access(authSetupLockPath);
    return true;
  } catch (error) {
    if (isNodeErrorWithCode(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function writeAuthSetupLock(payload: {
  reason: AuthSetupLockReason;
  email?: string;
  source?: string;
}) {
  await fs.mkdir(dataDirPath, { recursive: true });
  const lockData: AuthSetupLockPayload = {
    createdAt: new Date().toISOString(),
    reason: payload.reason,
    email: payload.email,
    source: payload.source || "unknown",
  };

  try {
    await fs.writeFile(authSetupLockPath, JSON.stringify(lockData, null, 2), {
      encoding: "utf8",
      flag: "wx",
    });
    return "created" as const;
  } catch (error) {
    if (isNodeErrorWithCode(error) && error.code === "EEXIST") {
      return "already_exists" as const;
    }
    throw error;
  }
}

async function removeAuthSetupBootstrapLock() {
  try {
    await fs.unlink(authSetupBootstrapLockPath);
  } catch (error) {
    if (isNodeErrorWithCode(error) && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

async function releaseAuthSetupBootstrapGateClaim(claimPath: string) {
  try {
    await fs.rmdir(claimPath);
  } catch (error) {
    if (isNodeErrorWithCode(error) && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

async function tryAcquireAuthSetupBootstrapGate() {
  await fs.mkdir(authSetupBootstrapGatePath, { recursive: true });
  // Claims have unique paths so stale cleanup and delayed releases can never
  // remove a newer owner's gate. Only the sole active claim enters the
  // bootstrap-lock critical section; competing claims fail closed.
  const claimPath = path.join(
    authSetupBootstrapGatePath,
    `${authSetupBootstrapGateClaimPrefix}${randomUUID()}`,
  );
  await fs.mkdir(claimPath);

  try {
    const entries = await fs.readdir(authSetupBootstrapGatePath, {
      withFileTypes: true,
    });
    const activeClaimPaths: string[] = [];

    for (const entry of entries) {
      if (
        !entry.isDirectory() ||
        !entry.name.startsWith(authSetupBootstrapGateClaimPrefix)
      ) {
        continue;
      }

      const candidatePath = path.join(authSetupBootstrapGatePath, entry.name);
      let isStale = false;
      try {
        const stats = await fs.stat(candidatePath);
        isStale = Date.now() - stats.mtimeMs > authSetupBootstrapGateStaleMs;
      } catch (error) {
        if (isNodeErrorWithCode(error) && error.code === "ENOENT") {
          continue;
        }
        throw error;
      }

      if (isStale) {
        await releaseAuthSetupBootstrapGateClaim(candidatePath);
        continue;
      }
      activeClaimPaths.push(candidatePath);
    }

    if (activeClaimPaths.length === 1 && activeClaimPaths[0] === claimPath) {
      return claimPath;
    }
  } catch (error) {
    await releaseAuthSetupBootstrapGateClaim(claimPath);
    throw error;
  }

  await releaseAuthSetupBootstrapGateClaim(claimPath);
  return null;
}

async function acquireAuthSetupBootstrapGateWithWait() {
  const deadline = Date.now() + authSetupBootstrapGateMaxWaitMs;
  while (true) {
    const claimPath = await tryAcquireAuthSetupBootstrapGate();
    if (claimPath) return claimPath;
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for auth setup bootstrap lock gate.");
    }
    await new Promise<void>((resolve) =>
      setTimeout(resolve, authSetupBootstrapGateRetryMs),
    );
  }
}

async function isExistingBootstrapLockStale() {
  try {
    const raw = await fs.readFile(authSetupBootstrapLockPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<AuthSetupBootstrapLockPayload>;
    if (typeof parsed.createdAt !== "string") {
      return false;
    }
    const createdAtMs = Date.parse(parsed.createdAt);
    return (
      Number.isFinite(createdAtMs) &&
      Date.now() - createdAtMs > authSetupBootstrapLockStaleMs
    );
  } catch {
    return false;
  }
}

async function tryWriteAuthSetupBootstrapLock(source: string, ownerId: string) {
  const lockData: AuthSetupBootstrapLockPayload = {
    createdAt: new Date().toISOString(),
    ownerId,
    source,
  };

  try {
    await fs.writeFile(
      authSetupBootstrapLockPath,
      JSON.stringify(lockData, null, 2),
      {
        encoding: "utf8",
        flag: "wx",
      },
    );
    return true;
  } catch (error) {
    if (isNodeErrorWithCode(error) && error.code === "EEXIST") {
      return false;
    }
    throw error;
  }
}

async function releaseOwnedAuthSetupBootstrapLock(ownerId: string) {
  const gateClaimPath = await acquireAuthSetupBootstrapGateWithWait();
  try {
    let currentLock: Partial<AuthSetupBootstrapLockPayload> | null = null;
    try {
      const raw = await fs.readFile(authSetupBootstrapLockPath, "utf8");
      currentLock = JSON.parse(raw) as Partial<AuthSetupBootstrapLockPayload>;
    } catch (error) {
      if (isNodeErrorWithCode(error) && error.code === "ENOENT") {
        return;
      }
      throw error;
    }

    if (currentLock.ownerId === ownerId) {
      await removeAuthSetupBootstrapLock();
    }
  } finally {
    await releaseAuthSetupBootstrapGateClaim(gateClaimPath);
  }
}

export async function acquireAuthSetupBootstrapLock(payload?: {
  source?: string;
}) {
  await fs.mkdir(dataDirPath, { recursive: true });
  const source = payload?.source || "unknown";
  const ownerId = randomUUID();
  const gateClaimPath = await tryAcquireAuthSetupBootstrapGate();
  if (!gateClaimPath) {
    return {
      status: "busy" as const,
      release: async () => undefined,
    };
  }

  let acquired = false;
  try {
    acquired = await tryWriteAuthSetupBootstrapLock(source, ownerId);
    if (!acquired && (await isExistingBootstrapLockStale())) {
      await removeAuthSetupBootstrapLock();
      acquired = await tryWriteAuthSetupBootstrapLock(source, ownerId);
    }
  } finally {
    await releaseAuthSetupBootstrapGateClaim(gateClaimPath);
  }

  if (!acquired) {
    return {
      status: "busy" as const,
      release: async () => undefined,
    };
  }

  return {
    status: "acquired" as const,
    release: () => releaseOwnedAuthSetupBootstrapLock(ownerId),
  };
}

export function getAuthSetupLockPath() {
  return authSetupLockPath;
}
