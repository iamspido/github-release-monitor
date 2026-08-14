import { createHash } from "node:crypto";

const PASSWORD_RESET_RATE_LIMIT_WINDOW_MS = 60_000;
const PASSWORD_RESET_RATE_LIMIT_MAX_REQUESTS = 3;
const MAX_PASSWORD_RESET_RATE_LIMIT_ENTRIES = 10_000;

type PasswordResetRateLimitState = {
  count: number;
  windowStartedAt: number;
};

declare global {
  var _authPasswordResetRequests:
    | Map<string, PasswordResetRateLimitState>
    | undefined;
}

global._authPasswordResetRequests ??= new Map<
  string,
  PasswordResetRateLimitState
>();

const requests = global._authPasswordResetRequests;

function pruneExpiredEntries(now: number) {
  for (const [key, state] of requests) {
    if (now - state.windowStartedAt >= PASSWORD_RESET_RATE_LIMIT_WINDOW_MS) {
      requests.delete(key);
    }
  }
}

export function consumePasswordResetRequest(
  clientIp: string,
  identifier: string,
  now = Date.now(),
): { allowed: boolean; retryAfterSeconds: number } {
  pruneExpiredEntries(now);
  const normalizedIdentifier = identifier.trim().toLowerCase().slice(0, 320);
  const identifierHash = createHash("sha256")
    .update(normalizedIdentifier || "unknown")
    .digest("hex");
  const keys = [
    `identifier:${identifierHash}`,
    ...(clientIp && clientIp !== "unknown" ? [`ip:${clientIp}`] : []),
  ];
  const blockedStates = keys
    .map((key) => requests.get(key))
    .filter(
      (state): state is PasswordResetRateLimitState =>
        state !== undefined &&
        state.count >= PASSWORD_RESET_RATE_LIMIT_MAX_REQUESTS,
    );
  if (blockedStates.length > 0) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(
        1,
        ...blockedStates.map((state) =>
          Math.ceil(
            (state.windowStartedAt +
              PASSWORD_RESET_RATE_LIMIT_WINDOW_MS -
              now) /
              1_000,
          ),
        ),
      ),
    };
  }

  for (const key of keys) {
    const existing = requests.get(key);
    if (existing) {
      requests.delete(key);
      requests.set(key, { ...existing, count: existing.count + 1 });
      continue;
    }
    if (requests.size >= MAX_PASSWORD_RESET_RATE_LIMIT_ENTRIES) {
      const oldestKey = requests.keys().next().value;
      if (oldestKey !== undefined) requests.delete(oldestKey);
    }
    requests.set(key, { count: 1, windowStartedAt: now });
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

export function clearPasswordResetRateLimitForTests() {
  requests.clear();
}
