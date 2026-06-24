import { logger } from "@/lib/logger";

type LoginAttemptState = {
  failures: number;
  firstFailedAt: number;
  lastFailedAt: number;
  lockedUntil: number;
};

export type FailedLoginAttemptResult = {
  lockoutTriggered: boolean;
  failures: number;
  attemptsRemaining: number;
  lockoutRemainingSeconds: number;
};

export type FailedLoginAttemptReason = "invalid_input" | "invalid_credentials";

declare global {
  var _authLoginAttempts: Map<string, LoginAttemptState> | undefined;
}

global._authLoginAttempts ??= new Map<string, LoginAttemptState>();
const failedLoginAttempts = global._authLoginAttempts as Map<
  string,
  LoginAttemptState
>;

const DEFAULT_LOGIN_ATTEMPTS = 5;
const DEFAULT_ATTEMPT_WINDOW_SECONDS = 15 * 60;
const DEFAULT_LOCKOUT_SECONDS = 15 * 60;

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
  for (const [key, state] of failedLoginAttempts.entries()) {
    if (state.lockedUntil > now) continue;
    if (now - state.lastFailedAt > loginAttemptWindowMs) {
      failedLoginAttempts.delete(key);
    }
  }
}

export function isLoginRateLimited(key: string, now: number): boolean {
  const state = failedLoginAttempts.get(key);
  if (!state) return false;
  if (state.lockedUntil > now) {
    return true;
  }
  if (
    state.lockedUntil <= now &&
    now - state.lastFailedAt > loginAttemptWindowMs
  ) {
    failedLoginAttempts.delete(key);
  }
  return false;
}

export function getLoginLockoutRemainingSeconds(
  key: string,
  now: number,
): number {
  const state = failedLoginAttempts.get(key);
  if (!state || state.lockedUntil <= now) return 0;
  return Math.ceil((state.lockedUntil - now) / 1_000);
}

export function registerFailedLoginAttempt(
  key: string,
  now: number,
): FailedLoginAttemptResult {
  const existing = failedLoginAttempts.get(key);
  if (!existing || now - existing.firstFailedAt > loginAttemptWindowMs) {
    const failures = 1;
    const attemptsRemaining = Math.max(loginAttemptLimit - failures, 0);
    failedLoginAttempts.set(key, {
      failures,
      firstFailedAt: now,
      lastFailedAt: now,
      lockedUntil: 0,
    });
    return {
      lockoutTriggered: false,
      failures,
      attemptsRemaining,
      lockoutRemainingSeconds: 0,
    };
  }

  const failures = existing.failures + 1;
  const lockedUntil =
    failures >= loginAttemptLimit ? now + loginLockoutMs : existing.lockedUntil;
  const lockoutTriggered = lockedUntil > now;
  const attemptsRemaining = Math.max(loginAttemptLimit - failures, 0);
  const lockoutRemainingSeconds = lockoutTriggered
    ? Math.ceil((lockedUntil - now) / 1_000)
    : 0;
  failedLoginAttempts.set(key, {
    failures,
    firstFailedAt: existing.firstFailedAt,
    lastFailedAt: now,
    lockedUntil,
  });
  return {
    lockoutTriggered,
    failures,
    attemptsRemaining,
    lockoutRemainingSeconds,
  };
}

export function clearFailedLoginAttempts(key: string): void {
  failedLoginAttempts.delete(key);
}

export function getFailedLoginFailures(key: string): number {
  return failedLoginAttempts.get(key)?.failures ?? 0;
}

export function clearExpiredLoginLockout(
  key: string,
  now: number,
): { wasCleared: boolean; failures: number } {
  const state = failedLoginAttempts.get(key);
  if (!state) return { wasCleared: false, failures: 0 };
  if (state.lockedUntil <= 0 || state.lockedUntil > now) {
    return { wasCleared: false, failures: 0 };
  }

  failedLoginAttempts.set(key, {
    ...state,
    lockedUntil: 0,
  });
  return { wasCleared: true, failures: state.failures };
}

export function logFailedLoginAttempt(args: {
  identifier: string;
  clientIp: string;
  reason: FailedLoginAttemptReason;
  result: FailedLoginAttemptResult;
  prefix?: string;
}): void {
  const reasonLabel =
    args.reason === "invalid_input" ? "invalid input" : "invalid credentials";
  const prefix = args.prefix ? `${args.prefix} ` : "";

  if (args.result.lockoutTriggered) {
    logger
      .withScope("Auth")
      .warn(
        `Failed ${prefix}login attempt for identifier='${args.identifier}' from ip='${args.clientIp}' (${reasonLabel}); lockout activated for ${args.result.lockoutRemainingSeconds}s after ${args.result.failures}/${loginAttemptLimit} failed attempts.`,
      );
    return;
  }

  logger
    .withScope("Auth")
    .warn(
      `Failed ${prefix}login attempt for identifier='${args.identifier}' from ip='${args.clientIp}' (${reasonLabel}); attempts=${args.result.failures}/${loginAttemptLimit}, remaining_before_lockout=${args.result.attemptsRemaining}.`,
    );
}
