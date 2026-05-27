import { promises as fs } from "node:fs";
import path from "node:path";

const dataDirPath = path.join(process.cwd(), "data");
const authSetupLockPath = path.join(dataDirPath, "auth-setup.lock");
const authSetupBootstrapLockPath = path.join(
  dataDirPath,
  "auth-setup-bootstrap.lock",
);
const authSetupBootstrapLockStaleMs = 10 * 60 * 1_000;

type AuthSetupLockReason = "setup_completed" | "user_exists";

type AuthSetupLockPayload = {
  createdAt: string;
  reason: AuthSetupLockReason;
  email?: string;
  source: string;
};

type AuthSetupBootstrapLockPayload = {
  createdAt: string;
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
  } catch {
    return false;
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

async function tryWriteAuthSetupBootstrapLock(source: string) {
  const lockData: AuthSetupBootstrapLockPayload = {
    createdAt: new Date().toISOString(),
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

export async function acquireAuthSetupBootstrapLock(payload?: {
  source?: string;
}) {
  await fs.mkdir(dataDirPath, { recursive: true });
  const source = payload?.source || "unknown";
  let acquired = await tryWriteAuthSetupBootstrapLock(source);
  if (!acquired && (await isExistingBootstrapLockStale())) {
    await removeAuthSetupBootstrapLock();
    acquired = await tryWriteAuthSetupBootstrapLock(source);
  }

  if (!acquired) {
    return {
      status: "busy" as const,
      release: async () => undefined,
    };
  }

  return {
    status: "acquired" as const,
    release: removeAuthSetupBootstrapLock,
  };
}

export function getAuthSetupLockPath() {
  return authSetupLockPath;
}
