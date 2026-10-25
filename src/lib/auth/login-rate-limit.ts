import {
  type LoginAttemptState,
  loginRateLimitStore,
} from "@/lib/auth/login-rate-limit-store";
import {
  ACCOUNT_RATE_LIMIT_KEY_PREFIX,
  getLoginIdentifierLogLabel,
} from "@/lib/auth/request-context";
import { logger } from "@/lib/logger";

export {
  MAX_LOGIN_RATE_LIMIT_ENTRIES,
  MAX_LOGIN_RATE_LIMIT_OVERFLOW_ENTRIES,
} from "@/lib/auth/login-rate-limit-store";

export type FailedLoginAttemptResult = {
  lockoutTriggered: boolean;
  failures: number;
  limit: number;
  attemptsRemaining: number;
  lockoutRemainingSeconds: number;
};

export type FailedLoginAttemptReason = "invalid_credentials";
export type LoginRateLimitKey = string | readonly string[];

const DEFAULT_LOGIN_ATTEMPTS = 5;
// The bucket an identifier shares across all client addresses locks at this
// multiple of the limit (20 by default) and counts failures per window too.
const ACCOUNT_LOGIN_ATTEMPTS_FACTOR = 4;
const DEFAULT_ATTEMPT_WINDOW_SECONDS = 15 * 60;
const DEFAULT_LOCKOUT_SECONDS = 15 * 60;
const LOGIN_STATE_PRUNE_INTERVAL_MS = 60_000;
function getFailedLoginState(key: string): LoginAttemptState | undefined {
  return loginRateLimitStore.get(key);
}

function parseBoundedIntegerEnv(
  name: string,
  defaultValue: number,
  min: number,
  max: number,
): number {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return defaultValue;
  const rounded = Math.round(parsed);
  return Math.min(Math.max(rounded, min), max);
}

const loginAttemptLimit = parseBoundedIntegerEnv(
  "AUTH_MAX_LOGIN_ATTEMPTS",
  DEFAULT_LOGIN_ATTEMPTS,
  1,
  20,
);
const accountLoginAttemptLimit =
  loginAttemptLimit * ACCOUNT_LOGIN_ATTEMPTS_FACTOR;
const loginAttemptWindowMs =
  parseBoundedIntegerEnv(
    "AUTH_LOGIN_WINDOW_SECONDS",
    DEFAULT_ATTEMPT_WINDOW_SECONDS,
    1,
    24 * 60 * 60,
  ) * 1_000;
const loginLockoutMs =
  parseBoundedIntegerEnv(
    "AUTH_LOGIN_LOCKOUT_SECONDS",
    DEFAULT_LOCKOUT_SECONDS,
    1,
    24 * 60 * 60,
  ) * 1_000;

export function pruneFailedLoginState(now: number): void {
  loginRateLimitStore.prune(
    now,
    loginAttemptWindowMs,
    LOGIN_STATE_PRUNE_INTERVAL_MS,
  );
}

function setFailedLoginState(key: string, state: LoginAttemptState): void {
  loginRateLimitStore.set(key, state);
}

function normalizeKeys(key: LoginRateLimitKey): readonly string[] {
  return typeof key === "string" ? [key] : key;
}

function getLoginAttemptLimit(key: string): number {
  return key.startsWith(ACCOUNT_RATE_LIMIT_KEY_PREFIX)
    ? accountLoginAttemptLimit
    : loginAttemptLimit;
}

function isSingleLoginRateLimited(key: string, now: number): boolean {
  const state = getFailedLoginState(key);
  if (!state) return false;
  if (state.lockedUntil > now) {
    setFailedLoginState(key, state);
    return true;
  }
  if (
    state.lockedUntil <= now &&
    now - state.lastFailedAt > loginAttemptWindowMs
  ) {
    clearFailedLoginAttempts(key);
  }
  return false;
}

export function isLoginRateLimited(
  key: LoginRateLimitKey,
  now: number,
): boolean {
  return normalizeKeys(key).some((candidate) =>
    isSingleLoginRateLimited(candidate, now),
  );
}

export function getLoginLockoutRemainingSeconds(
  key: LoginRateLimitKey,
  now: number,
): number {
  const keys = normalizeKeys(key);
  return keys.length === 0
    ? 0
    : Math.max(
        ...keys.map((candidate) => {
          const state = getFailedLoginState(candidate);
          if (!state || state.lockedUntil <= now) return 0;
          return Math.ceil((state.lockedUntil - now) / 1_000);
        }),
      );
}

function registerSingleFailedLoginAttempt(
  key: string,
  now: number,
): FailedLoginAttemptResult {
  const limit = getLoginAttemptLimit(key);
  const existing = getFailedLoginState(key);
  // An already locked key triggers nothing again: one log line per lockout.
  const wasLocked = (existing?.lockedUntil ?? 0) > now;
  const current =
    existing && now - existing.firstFailedAt <= loginAttemptWindowMs
      ? existing
      : null;
  const failures = (current?.failures ?? 0) + 1;
  const lockedUntil =
    failures >= limit ? now + loginLockoutMs : (current?.lockedUntil ?? 0);
  const lockoutTriggered = lockedUntil > now && !wasLocked;
  setFailedLoginState(key, {
    failures,
    firstFailedAt: current?.firstFailedAt ?? now,
    lastFailedAt: now,
    lockedUntil,
  });
  return {
    lockoutTriggered,
    failures,
    limit,
    attemptsRemaining: Math.max(limit - failures, 0),
    lockoutRemainingSeconds: lockoutTriggered
      ? Math.ceil((lockedUntil - now) / 1_000)
      : 0,
  };
}

export function registerFailedLoginAttempt(
  key: LoginRateLimitKey,
  now: number,
): FailedLoginAttemptResult {
  const results = normalizeKeys(key).map((candidate) =>
    registerSingleFailedLoginAttempt(candidate, now),
  );
  if (results.length === 0) {
    return {
      lockoutTriggered: false,
      failures: 1,
      limit: loginAttemptLimit,
      attemptsRemaining: Math.max(loginAttemptLimit - 1, 0),
      lockoutRemainingSeconds: 0,
    };
  }
  // One bucket with its own limit, so a log line never mixes two buckets.
  return (
    results.find((result) => result.lockoutTriggered) ??
    results.reduce((closest, result) =>
      result.attemptsRemaining < closest.attemptsRemaining ? result : closest,
    )
  );
}

export function clearFailedLoginAttempts(key: LoginRateLimitKey): void {
  for (const candidate of normalizeKeys(key)) {
    loginRateLimitStore.delete(candidate);
  }
}

export function getFailedLoginFailures(key: LoginRateLimitKey): number {
  const keys = normalizeKeys(key);
  return keys.length === 0
    ? 0
    : Math.max(
        ...keys.map(
          (candidate) => getFailedLoginState(candidate)?.failures ?? 0,
        ),
      );
}

export function clearExpiredLoginLockout(
  key: LoginRateLimitKey,
  now: number,
): { wasCleared: boolean; failures: number } {
  let wasCleared = false;
  let failures = 0;
  for (const candidate of normalizeKeys(key)) {
    const state = getFailedLoginState(candidate);
    if (!state || state.lockedUntil <= 0 || state.lockedUntil > now) {
      continue;
    }
    setFailedLoginState(candidate, { ...state, lockedUntil: 0 });
    wasCleared = true;
    failures = Math.max(failures, state.failures);
  }
  return { wasCleared, failures };
}

// Attempts are reserved before the password check so that concurrent ones
// cannot all pass the lockout read before a failure is booked (CWE-307).

declare global {
  var _authLoginAttemptsInFlight: Map<string, number> | undefined;
  var _authLoginAttemptWaiters: Set<() => void> | undefined;
}

global._authLoginAttemptsInFlight ??= new Map<string, number>();
global._authLoginAttemptWaiters ??= new Set<() => void>();
const attemptsInFlight = global._authLoginAttemptsInFlight;
const attemptWaiters = global._authLoginAttemptWaiters;

/** Exactly one end applies: `release` after another is a no-op for `finally`,
 * while `fail` or `succeed` after another throws. */
export type LoginAttemptReservation = {
  fail: () => FailedLoginAttemptResult;
  succeed: (cleared?: LoginRateLimitKey) => void;
  release: () => void;
};

export type LoginAttemptAdmission =
  | { reservation: LoginAttemptReservation; lockoutRemainingSeconds?: never }
  | { reservation: null; lockoutRemainingSeconds: number };

function isLockedByAttemptsInFlight(key: string, now: number): boolean {
  const inFlight = attemptsInFlight.get(key) ?? 0;
  if (inFlight === 0) return false;
  const state = getFailedLoginState(key);
  const failures =
    state && now - state.firstFailedAt <= loginAttemptWindowMs
      ? state.failures
      : 0;
  return failures + inFlight >= getLoginAttemptLimit(key);
}

function wakeAttemptWaiters(): void {
  const waiting = [...attemptWaiters];
  attemptWaiters.clear();
  for (const wake of waiting) wake();
}

/** Waits while the attempts in flight could still lock the key. */
export async function reserveLoginAttempt(
  key: LoginRateLimitKey,
): Promise<LoginAttemptAdmission> {
  const keys = normalizeKeys(key);
  for (;;) {
    const now = Date.now();
    if (isLoginRateLimited(keys, now)) {
      return {
        reservation: null,
        lockoutRemainingSeconds: getLoginLockoutRemainingSeconds(keys, now),
      };
    }
    if (!keys.some((candidate) => isLockedByAttemptsInFlight(candidate, now))) {
      break;
    }
    await new Promise<void>((resolve) => {
      attemptWaiters.add(resolve);
    });
  }
  for (const candidate of keys) {
    attemptsInFlight.set(candidate, (attemptsInFlight.get(candidate) ?? 0) + 1);
  }
  let open = true;
  const end = () => {
    open = false;
    for (const candidate of keys) {
      const left = (attemptsInFlight.get(candidate) ?? 1) - 1;
      if (left > 0) attemptsInFlight.set(candidate, left);
      else attemptsInFlight.delete(candidate);
    }
    wakeAttemptWaiters();
  };
  const assertOpen = (name: "fail" | "succeed") => {
    if (!open) {
      throw new Error(
        `Login attempt reservation already ended; ${name}() must not follow another end.`,
      );
    }
  };
  return {
    reservation: {
      fail: () => {
        assertOpen("fail");
        const result = registerFailedLoginAttempt(keys, Date.now());
        end();
        return result;
      },
      succeed: (cleared = keys) => {
        assertOpen("succeed");
        clearFailedLoginAttempts(cleared);
        end();
      },
      release: () => {
        if (open) end();
      },
    },
  };
}

const failedLoginAttemptReasonLabels: Record<FailedLoginAttemptReason, string> =
  { invalid_credentials: "invalid credentials" };

export function logFailedLoginAttempt(args: {
  identifier: string;
  clientIp: string;
  reason: FailedLoginAttemptReason;
  result: FailedLoginAttemptResult;
  prefix?: string;
}): void {
  const reasonLabel = failedLoginAttemptReasonLabels[args.reason];
  const prefix = args.prefix ? `${args.prefix} ` : "";
  const identifierLabel = getLoginIdentifierLogLabel(args.identifier);

  if (args.result.lockoutTriggered) {
    logger
      .withScope("Auth")
      .warn(
        `Failed ${prefix}login attempt for ${identifierLabel} from ip='${args.clientIp}' (${reasonLabel}); lockout activated for ${args.result.lockoutRemainingSeconds}s after ${args.result.failures}/${args.result.limit} failed attempts.`,
      );
    return;
  }

  logger
    .withScope("Auth")
    .warn(
      `Failed ${prefix}login attempt for ${identifierLabel} from ip='${args.clientIp}' (${reasonLabel}); attempts=${args.result.failures}/${args.result.limit}, remaining_before_lockout=${args.result.attemptsRemaining}.`,
    );
}
