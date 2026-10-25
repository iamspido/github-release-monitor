import { auth, ensureAuthDatabaseReady } from "@/lib/auth";
import {
  clearExpiredLoginLockout,
  getFailedLoginFailures,
  type LoginAttemptReservation,
  logFailedLoginAttempt,
  pruneFailedLoginState,
  reserveLoginAttempt,
} from "@/lib/auth/login-rate-limit";
import {
  getLoginIdentifierLogLabel,
  getLoginRequestContext,
  isLikelyEmail,
} from "@/lib/auth/request-context";
import { logger } from "@/lib/logger";

export type PasswordLoginResult =
  | {
      ok: true;
      response: Response;
      requiresTwoFactor: boolean;
    }
  | {
      ok: false;
      errorKey: "error_invalid_credentials" | "error_too_many_attempts";
      status: number;
    };

async function hasTwoFactorRedirectFlag(response: Response): Promise<boolean> {
  try {
    const data = (await response.clone().json()) as {
      twoFactorRedirect?: unknown;
    };
    return data.twoFactorRedirect === true;
  } catch {
    return false;
  }
}

export async function authenticatePassword(input: {
  headers: Headers;
  identifier: string;
  password: string;
}): Promise<PasswordLoginResult> {
  const { identifier } = input;
  const {
    rateLimitKey,
    accountRateLimitKey,
    accountWideRateLimitKey,
    clientIp,
  } = getLoginRequestContext(input.headers, identifier);
  const identifierLabel = getLoginIdentifierLogLabel(identifier);
  const now = Date.now();
  const methodLabel = isLikelyEmail(identifier) ? "email" : "username";
  const log = logger.withScope("Auth");

  log.info(
    `Password login attempt started for ${identifierLabel} from ip='${clientIp}' using ${methodLabel}.`,
  );

  // Empty input is refused uncounted: booking it would lock an identifier or
  // address for free and fill the lockout store.
  if (!identifier.trim() || !input.password) {
    log.warn(
      `Failed password login attempt for ${identifierLabel} from ip='${clientIp}' (invalid input); refused without a check and not counted.`,
    );
    return { ok: false, errorKey: "error_invalid_credentials", status: 400 };
  }

  const expiredLockout = clearExpiredLoginLockout(rateLimitKey, now);
  if (expiredLockout.wasCleared) {
    log.info(
      `Password login lockout expired for ${identifierLabel} from ip='${clientIp}' after ${expiredLockout.failures} failed attempt(s).`,
    );
  }
  pruneFailedLoginState(now);

  const admission = await reserveLoginAttempt(rateLimitKey);
  if (!admission.reservation) {
    log.warn(
      `Blocked password login attempt for ${identifierLabel} from ip='${clientIp}' due to active lockout (${admission.lockoutRemainingSeconds}s remaining).`,
    );
    return { ok: false, errorKey: "error_too_many_attempts", status: 429 };
  }
  const attempt = admission.reservation;
  try {
    return await checkPassword({
      ...input,
      attempt,
      // A valid account may clear its own failure history, but not the shared
      // IP bucket that protects other accounts from credential spraying.
      accountRateLimitKeys: [
        accountRateLimitKey,
        accountWideRateLimitKey,
      ].filter((key): key is string => key !== null),
      clientIp,
      identifierLabel,
      methodLabel,
    });
  } finally {
    attempt.release();
  }
}

async function checkPassword(input: {
  headers: Headers;
  identifier: string;
  password: string;
  attempt: LoginAttemptReservation;
  accountRateLimitKeys: readonly string[];
  clientIp: string;
  identifierLabel: string;
  methodLabel: "email" | "username";
}): Promise<PasswordLoginResult> {
  const {
    identifier,
    password,
    attempt,
    accountRateLimitKeys,
    clientIp,
    identifierLabel,
    methodLabel,
  } = input;
  const log = logger.withScope("Auth");

  await ensureAuthDatabaseReady();
  const response =
    methodLabel === "email"
      ? await auth.api.signInEmail({
          headers: input.headers,
          body: { email: identifier.toLowerCase(), password },
          asResponse: true,
        })
      : await auth.api.signInUsername({
          headers: input.headers,
          body: { username: identifier, password },
          asResponse: true,
        });

  log.info(
    `Primary auth API response for ${identifierLabel} from ip='${clientIp}' returned status=${response.status}.`,
  );

  if (!response.ok) {
    const failedAttempt = attempt.fail();
    log.warn(
      `Password login rejected for ${identifierLabel} from ip='${clientIp}' with status=${response.status}.`,
    );
    logFailedLoginAttempt({
      identifier,
      clientIp,
      reason: "invalid_credentials",
      result: failedAttempt,
      prefix: "password",
    });
    return {
      ok: false,
      errorKey: failedAttempt.lockoutTriggered
        ? "error_too_many_attempts"
        : "error_invalid_credentials",
      status: response.status || 401,
    };
  }

  const requiresTwoFactor = await hasTwoFactorRedirectFlag(response);
  const previousFailures = getFailedLoginFailures(accountRateLimitKeys);
  attempt.succeed(accountRateLimitKeys);

  if (requiresTwoFactor) {
    log.info(
      `Primary auth factor valid for ${identifierLabel} from ip='${clientIp}'. Awaiting OTP verification.`,
    );
  } else {
    log.info(
      `Successful password login for ${identifierLabel} from ip='${clientIp}'.`,
    );
  }
  if (previousFailures > 0) {
    log.info(
      `Cleared ${previousFailures} failed password login attempt(s) for ${identifierLabel} from ip='${clientIp}' after successful authentication.`,
    );
  }

  return { ok: true, response, requiresTwoFactor };
}
