"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getLocale } from "next-intl/server";
import { pathnames } from "@/i18n/routing";
import {
  auth,
  ensureAuthDatabaseReady,
  findRegistrationConflict,
} from "@/lib/auth";
import { logger } from "@/lib/logger";
import { isPasswordPolicyValid } from "@/lib/password-policy";
import { redirectLocalized } from "@/lib/redirect-localized";
import { isUsernamePolicyValid } from "@/lib/username-policy";

type LoginAttemptState = {
  failures: number;
  firstFailedAt: number;
  lastFailedAt: number;
  lockedUntil: number;
};

type FailedAttemptResult = {
  lockoutTriggered: boolean;
  failures: number;
  attemptsRemaining: number;
  lockoutRemainingSeconds: number;
};

type FailedAttemptReason = "invalid_input" | "invalid_credentials";

export type LoginActionState = {
  errorKey?: string;
  requiresTwoFactor?: boolean;
  redirectTo?: string;
};

export type RegisterActionState = {
  errorKey?: string;
};

declare global {
  var _failedLoginAttempts: Map<string, LoginAttemptState> | undefined;
}

global._failedLoginAttempts ??= new Map<string, LoginAttemptState>();
const failedLoginAttempts = global._failedLoginAttempts as Map<
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
const loginAttemptWindowSeconds = parseBoundedIntegerEnv(
  "AUTH_LOGIN_WINDOW_SECONDS",
  DEFAULT_ATTEMPT_WINDOW_SECONDS,
  1,
  24 * 60 * 60,
);
const loginLockoutSeconds = parseBoundedIntegerEnv(
  "AUTH_LOGIN_LOCKOUT_SECONDS",
  DEFAULT_LOCKOUT_SECONDS,
  1,
  24 * 60 * 60,
);
const loginAttemptWindowMs = loginAttemptWindowSeconds * 1_000;
const loginLockoutMs = loginLockoutSeconds * 1_000;

function getClientIp(headerStore: Headers): string {
  const forwardedFor = headerStore.get("x-forwarded-for");
  const firstForwardedIp = forwardedFor?.split(",")[0]?.trim();
  const realIp = headerStore.get("x-real-ip")?.trim();
  return (firstForwardedIp || realIp || "unknown").slice(0, 128);
}

function getLoginRequestContext(
  headerStore: Headers,
  identifier: string,
): {
  rateLimitKey: string;
  clientIp: string;
} {
  const ip = getClientIp(headerStore);
  const normalizedIdentifier = identifier.trim().toLowerCase().slice(0, 128);
  return {
    rateLimitKey: `${ip}:${normalizedIdentifier || "unknown"}`,
    clientIp: ip,
  };
}

function isLikelyEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isValidUsername(value: string) {
  return isUsernamePolicyValid(value);
}

function normalizeAuthApiErrorCode(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

async function getAuthApiErrorCode(response: Response) {
  try {
    const payload = (await response.clone().json()) as {
      error?: unknown;
      code?: unknown;
    };
    return (
      normalizeAuthApiErrorCode(payload.error) ||
      normalizeAuthApiErrorCode(payload.code)
    );
  } catch {
    return "";
  }
}

function mapRegisterErrorToSetupError(errorCode: string): string {
  if (!errorCode) {
    return "error_setup_failed";
  }

  if (
    errorCode === "user_already_exists" ||
    errorCode === "email_already_exists" ||
    errorCode === "email_already_in_use" ||
    errorCode === "email_in_use"
  ) {
    return "error_setup_email_in_use";
  }

  if (
    errorCode === "username_already_exists" ||
    errorCode === "username_already_in_use" ||
    errorCode === "username_in_use" ||
    errorCode === "username_taken"
  ) {
    return "error_setup_username_in_use";
  }

  if (errorCode === "invalid_email" || errorCode === "email_invalid") {
    return "error_setup_invalid_email";
  }

  if (errorCode === "invalid_username" || errorCode === "username_invalid") {
    return "error_setup_invalid_username";
  }

  if (
    errorCode === "invalid_password" ||
    errorCode === "weak_password" ||
    errorCode === "password_too_weak" ||
    errorCode === "password_policy_violation"
  ) {
    return "error_setup_invalid_password_policy";
  }

  if (errorCode === "signup_disabled" || errorCode === "invalid_input") {
    return "error_setup_invalid_input";
  }

  return "error_setup_failed";
}

function pruneFailedLoginState(now: number) {
  for (const [key, state] of failedLoginAttempts.entries()) {
    if (state.lockedUntil > now) continue;
    if (now - state.lastFailedAt > loginAttemptWindowMs) {
      failedLoginAttempts.delete(key);
    }
  }
}

function isRateLimited(key: string, now: number): boolean {
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

function getLockoutRemainingSeconds(key: string, now: number): number {
  const state = failedLoginAttempts.get(key);
  if (!state || state.lockedUntil <= now) return 0;
  return Math.ceil((state.lockedUntil - now) / 1_000);
}

function registerFailedAttempt(key: string, now: number): FailedAttemptResult {
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

function clearFailedAttempts(key: string) {
  failedLoginAttempts.delete(key);
}

function clearExpiredLockout(
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

function logFailedLoginAttempt(
  identifier: string,
  clientIp: string,
  reason: FailedAttemptReason,
  result: FailedAttemptResult,
) {
  const reasonLabel =
    reason === "invalid_input" ? "invalid input" : "invalid credentials";

  if (result.lockoutTriggered) {
    logger
      .withScope("Auth")
      .warn(
        `Failed login attempt for identifier='${identifier}' from ip='${clientIp}' (${reasonLabel}); lockout activated for ${result.lockoutRemainingSeconds}s after ${result.failures}/${loginAttemptLimit} failed attempts.`,
      );
    return;
  }

  logger
    .withScope("Auth")
    .warn(
      `Failed login attempt for identifier='${identifier}' from ip='${clientIp}' (${reasonLabel}); attempts=${result.failures}/${loginAttemptLimit}, remaining_before_lockout=${result.attemptsRemaining}.`,
    );
}

async function hasTwoFactorRedirectFlag(payload: unknown): Promise<boolean> {
  if (!payload || typeof payload !== "object") return false;

  const direct = (payload as { twoFactorRedirect?: unknown }).twoFactorRedirect;
  if (typeof direct === "boolean") {
    return direct;
  }

  if (typeof (payload as { clone?: unknown }).clone !== "function") {
    return false;
  }

  try {
    const cloned = (payload as { clone: () => Response }).clone();
    const data = (await cloned.json()) as { twoFactorRedirect?: unknown };
    return data.twoFactorRedirect === true;
  } catch {
    return false;
  }
}

export async function login(
  _previousState: LoginActionState | undefined,
  formData: FormData,
) {
  const email = formData.get("email");
  const password = formData.get("password");
  const next = formData.get("next");
  const identifierValue = typeof email === "string" ? email.trim() : "";
  const headerStore = await headers();
  const { rateLimitKey, clientIp } = getLoginRequestContext(
    headerStore,
    identifierValue,
  );
  const now = Date.now();
  const methodLabel = isLikelyEmail(identifierValue) ? "email" : "username";

  logger
    .withScope("Auth")
    .info(
      `Login attempt started for identifier='${identifierValue || "unknown"}' from ip='${clientIp}' using ${methodLabel}.`,
    );

  const expiredLockout = clearExpiredLockout(rateLimitKey, now);
  if (expiredLockout.wasCleared) {
    logger
      .withScope("Auth")
      .info(
        `Lockout expired for identifier='${identifierValue || "unknown"}' from ip='${clientIp}'. Access unblocked after ${expiredLockout.failures} failed attempt(s).`,
      );
  }

  pruneFailedLoginState(now);

  if (isRateLimited(rateLimitKey, now)) {
    const remainingSeconds = getLockoutRemainingSeconds(rateLimitKey, now);
    logger
      .withScope("Auth")
      .warn(
        `Blocked login attempt for identifier='${identifierValue || "unknown"}' from ip='${clientIp}' due to active lockout (${remainingSeconds}s remaining).`,
      );
    return { errorKey: "error_too_many_attempts" };
  }

  if (
    typeof email !== "string" ||
    !identifierValue ||
    typeof password !== "string" ||
    !password
  ) {
    const failedAttempt = registerFailedAttempt(rateLimitKey, now);
    logFailedLoginAttempt(
      typeof email === "string" ? identifierValue : "unknown",
      clientIp,
      "invalid_input",
      failedAttempt,
    );
    return { errorKey: "error_invalid_credentials" };
  }

  await ensureAuthDatabaseReady();
  const signInResponse =
    methodLabel === "email"
      ? await auth.api.signInEmail({
          headers: headerStore,
          body: { email: identifierValue.toLowerCase(), password },
          asResponse: true,
        })
      : await auth.api.signInUsername({
          headers: headerStore,
          body: { username: identifierValue, password },
          asResponse: true,
        });

  logger
    .withScope("Auth")
    .info(
      `Primary auth API response for identifier='${identifierValue}' from ip='${clientIp}' returned status=${signInResponse.status}.`,
    );

  if (signInResponse.ok) {
    const twoFactorRequired = await hasTwoFactorRedirectFlag(signInResponse);

    const previousFailures =
      failedLoginAttempts.get(rateLimitKey)?.failures ?? 0;
    clearFailedAttempts(rateLimitKey);
    if (twoFactorRequired) {
      logger
        .withScope("Auth")
        .info(
          `Primary auth factor valid for identifier='${identifierValue}' from ip='${clientIp}'. Awaiting OTP verification.`,
        );
      return { requiresTwoFactor: true };
    }

    logger
      .withScope("Auth")
      .info(
        `Successful login for identifier='${identifierValue}' from ip='${clientIp}'`,
      );
    if (previousFailures > 0) {
      logger
        .withScope("Auth")
        .info(
          `Cleared ${previousFailures} failed login attempt(s) for identifier='${identifierValue}' from ip='${clientIp}' after successful authentication.`,
        );
    }

    revalidatePath("/", "layout");
    const locale = await getLocale();
    let finalPath = "/";
    if (
      typeof next === "string" &&
      next.startsWith("/") &&
      !next.startsWith("//") &&
      !next.includes("..")
    ) {
      const pathWithoutLocale = next.startsWith(`/${locale}`)
        ? next.substring(`/${locale}`.length)
        : next;
      finalPath =
        (pathWithoutLocale.startsWith("/")
          ? pathWithoutLocale
          : `/${pathWithoutLocale}`) || "/";
    }

    logger
      .withScope("Auth")
      .info(
        `Login completed; client will navigate to '${finalPath}' (locale=${locale}).`,
      );
    return { redirectTo: `/${locale}${finalPath}` };
  }

  logger
    .withScope("Auth")
    .warn(
      `Login rejected for identifier='${identifierValue || "unknown"}' from ip='${clientIp}' with status=${signInResponse.status}.`,
    );

  const failedAttempt = registerFailedAttempt(rateLimitKey, now);
  logFailedLoginAttempt(
    identifierValue || "unknown",
    clientIp,
    "invalid_credentials",
    failedAttempt,
  );

  return {
    errorKey: failedAttempt.lockoutTriggered
      ? "error_too_many_attempts"
      : "error_invalid_credentials",
  };
}

export async function register(
  _previousState: RegisterActionState | undefined,
  formData: FormData,
) {
  const signupEnabled = process.env.AUTH_ENABLE_SIGNUP === "true";
  if (!signupEnabled) {
    return { errorKey: "error_setup_unavailable" };
  }

  const usernameRaw = formData.get("username");
  const emailRaw = formData.get("email");
  const passwordRaw = formData.get("password");
  const nameRaw = formData.get("name");

  const username = typeof usernameRaw === "string" ? usernameRaw.trim() : "";
  const email =
    typeof emailRaw === "string" ? emailRaw.trim().toLowerCase() : "";
  const password = typeof passwordRaw === "string" ? passwordRaw : "";
  const name = typeof nameRaw === "string" ? nameRaw.trim() : "";

  const headerStore = await headers();
  const clientIp = getClientIp(headerStore);

  logger
    .withScope("Auth")
    .info(
      `Registration attempt started for username='${username || "unknown"}' email='${email || "unknown"}' from ip='${clientIp}'.`,
    );

  if (!isValidUsername(username)) {
    return { errorKey: "error_setup_invalid_username" };
  }
  if (!isLikelyEmail(email)) {
    return { errorKey: "error_setup_invalid_email" };
  }
  if (!isPasswordPolicyValid(password.trim())) {
    return { errorKey: "error_setup_invalid_password_policy" };
  }

  await ensureAuthDatabaseReady();

  const registrationConflict = findRegistrationConflict(username, email);
  if (registrationConflict === "username_in_use") {
    logger
      .withScope("Auth")
      .warn(
        `Registration blocked for username='${username}' from ip='${clientIp}' because username is already in use.`,
      );
    return { errorKey: "error_setup_username_in_use" };
  }
  if (registrationConflict === "email_in_use") {
    logger
      .withScope("Auth")
      .warn(
        `Registration blocked for email='${email}' from ip='${clientIp}' because email is already in use.`,
      );
    return { errorKey: "error_setup_email_in_use" };
  }

  const signUpBody = {
    email,
    password,
    username,
    name: name || username,
  };

  const signUpResponse = await auth.api.signUpEmail({
    headers: headerStore,
    body: signUpBody,
    asResponse: true,
  });

  if (!signUpResponse.ok) {
    const errorCode = await getAuthApiErrorCode(signUpResponse);
    const mappedKey = mapRegisterErrorToSetupError(errorCode);
    logger
      .withScope("Auth")
      .warn(
        `Registration failed for username='${username || "unknown"}' email='${email || "unknown"}' from ip='${clientIp}' with status=${signUpResponse.status}${errorCode ? ` (error='${errorCode}')` : ""}.`,
      );
    return { errorKey: mappedKey };
  }

  logger
    .withScope("Auth")
    .info(
      `Registration successful for username='${username}' email='${email}' from ip='${clientIp}'. Redirecting to login.`,
    );
  const locale = await getLocale();
  const loginPath = pathnames["/login"][locale as "en" | "de"];
  redirectLocalized(`${loginPath}?registered=1`, locale);
}

export async function logout() {
  await ensureAuthDatabaseReady();
  const headerStore = await headers();
  const locale = await getLocale();
  const clientIp = getClientIp(headerStore);
  logger.withScope("Auth").info(`Logout requested from ip='${clientIp}'.`);

  const signOutResponse = await auth.api.signOut({
    headers: headerStore,
    asResponse: true,
  });
  if (!signOutResponse.ok) {
    logger
      .withScope("Auth")
      .warn(
        `Sign out returned a non-success status=${signOutResponse.status} for ip='${clientIp}'.`,
      );
  }

  logger
    .withScope("Auth")
    .info(
      `User logged out from ip='${clientIp}' with status=${signOutResponse.status}.`,
    );

  const loginPath = pathnames["/login"][locale as "en" | "de"];
  revalidatePath("/");
  redirectLocalized(loginPath, locale);
}
