import { getLoginIdentifierLogLabel } from "@/lib/auth/request-context";
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
export type LoginRateLimitKey = string | readonly string[];

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
const LOGIN_STATE_PRUNE_INTERVAL_MS = 60_000;
export const MAX_LOGIN_RATE_LIMIT_ENTRIES = 10_000;
let lastLoginStatePruneAt: number | null = null;
let capacityLockoutUntil = 0;

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
  if (
    lastLoginStatePruneAt !== null &&
    now >= lastLoginStatePruneAt &&
    now - lastLoginStatePruneAt < LOGIN_STATE_PRUNE_INTERVAL_MS
  ) {
    return;
  }
  lastLoginStatePruneAt = now;

  for (const [key, state] of failedLoginAttempts.entries()) {
    if (state.lockedUntil > now) continue;
    if (now - state.lastFailedAt > loginAttemptWindowMs) {
      failedLoginAttempts.delete(key);
    }
  }
  if (failedLoginAttempts.size < MAX_LOGIN_RATE_LIMIT_ENTRIES) {
    capacityLockoutUntil = 0;
  }
}

function setFailedLoginState(key: string, state: LoginAttemptState): void {
  const alreadyTracked = failedLoginAttempts.delete(key);
  if (
    !alreadyTracked &&
    failedLoginAttempts.size >= MAX_LOGIN_RATE_LIMIT_ENTRIES
  ) {
    const evictableKey = failedLoginAttempts
      .entries()
      .find(
        ([, candidate]) => candidate.lockedUntil <= state.lastFailedAt,
      )?.[0];
    if (evictableKey !== undefined) {
      failedLoginAttempts.delete(evictableKey);
    } else {
      capacityLockoutUntil = Math.min(
        ...Array.from(failedLoginAttempts.values(), (candidate) =>
          candidate.lockedUntil > state.lastFailedAt
            ? candidate.lockedUntil
            : Number.POSITIVE_INFINITY,
        ),
      );
      return;
    }
  }
  failedLoginAttempts.set(key, state);
}

function normalizeKeys(key: LoginRateLimitKey): readonly string[] {
  return typeof key === "string" ? [key] : key;
}

function isSingleLoginRateLimited(key: string, now: number): boolean {
  const state = failedLoginAttempts.get(key);
  if (!state) return false;
  if (state.lockedUntil > now) {
    setFailedLoginState(key, state);
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

export function isLoginRateLimited(
  key: LoginRateLimitKey,
  now: number,
): boolean {
  if (capacityLockoutUntil > now) return true;
  if (capacityLockoutUntil > 0) capacityLockoutUntil = 0;
  return normalizeKeys(key).some((candidate) =>
    isSingleLoginRateLimited(candidate, now),
  );
}

export function getLoginLockoutRemainingSeconds(
  key: LoginRateLimitKey,
  now: number,
): number {
  const capacityRemainingSeconds =
    capacityLockoutUntil > now
      ? Math.ceil((capacityLockoutUntil - now) / 1_000)
      : 0;
  const keys = normalizeKeys(key);
  return keys.length === 0
    ? capacityRemainingSeconds
    : Math.max(
        capacityRemainingSeconds,
        ...keys.map((candidate) => {
          const state = failedLoginAttempts.get(candidate);
          if (!state || state.lockedUntil <= now) return 0;
          return Math.ceil((state.lockedUntil - now) / 1_000);
        }),
      );
}

function registerSingleFailedLoginAttempt(
  key: string,
  now: number,
): FailedLoginAttemptResult {
  const existing = failedLoginAttempts.get(key);
  if (!existing || now - existing.firstFailedAt > loginAttemptWindowMs) {
    const failures = 1;
    const lockedUntil =
      failures >= loginAttemptLimit ? now + loginLockoutMs : 0;
    const lockoutTriggered = lockedUntil > now;
    const attemptsRemaining = Math.max(loginAttemptLimit - failures, 0);
    setFailedLoginState(key, {
      failures,
      firstFailedAt: now,
      lastFailedAt: now,
      lockedUntil,
    });
    return {
      lockoutTriggered,
      failures,
      attemptsRemaining,
      lockoutRemainingSeconds: lockoutTriggered
        ? Math.ceil((lockedUntil - now) / 1_000)
        : 0,
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
  setFailedLoginState(key, {
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
      attemptsRemaining: Math.max(loginAttemptLimit - 1, 0),
      lockoutRemainingSeconds: 0,
    };
  }
  return results.reduce((mostRestrictive, result) => ({
    lockoutTriggered:
      mostRestrictive.lockoutTriggered || result.lockoutTriggered,
    failures: Math.max(mostRestrictive.failures, result.failures),
    attemptsRemaining: Math.min(
      mostRestrictive.attemptsRemaining,
      result.attemptsRemaining,
    ),
    lockoutRemainingSeconds: Math.max(
      mostRestrictive.lockoutRemainingSeconds,
      result.lockoutRemainingSeconds,
    ),
  }));
}

export function clearFailedLoginAttempts(key: LoginRateLimitKey): void {
  for (const candidate of normalizeKeys(key)) {
    failedLoginAttempts.delete(candidate);
  }
  if (failedLoginAttempts.size < MAX_LOGIN_RATE_LIMIT_ENTRIES) {
    capacityLockoutUntil = 0;
  }
}

export function getFailedLoginFailures(key: LoginRateLimitKey): number {
  const keys = normalizeKeys(key);
  return keys.length === 0
    ? 0
    : Math.max(
        ...keys.map(
          (candidate) => failedLoginAttempts.get(candidate)?.failures ?? 0,
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
    const state = failedLoginAttempts.get(candidate);
    if (!state || state.lockedUntil <= 0 || state.lockedUntil > now) {
      continue;
    }
    setFailedLoginState(candidate, { ...state, lockedUntil: 0 });
    wasCleared = true;
    failures = Math.max(failures, state.failures);
  }
  return { wasCleared, failures };
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
  const identifierLabel = getLoginIdentifierLogLabel(args.identifier);

  if (args.result.lockoutTriggered) {
    logger
      .withScope("Auth")
      .warn(
        `Failed ${prefix}login attempt for ${identifierLabel} from ip='${args.clientIp}' (${reasonLabel}); lockout activated for ${args.result.lockoutRemainingSeconds}s after ${args.result.failures}/${loginAttemptLimit} failed attempts.`,
      );
    return;
  }

  logger
    .withScope("Auth")
    .warn(
      `Failed ${prefix}login attempt for ${identifierLabel} from ip='${args.clientIp}' (${reasonLabel}); attempts=${args.result.failures}/${loginAttemptLimit}, remaining_before_lockout=${args.result.attemptsRemaining}.`,
    );
}
