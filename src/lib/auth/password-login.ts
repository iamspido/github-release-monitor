import { auth, ensureAuthDatabaseReady } from "@/lib/auth";
import {
  clearExpiredLoginLockout,
  clearFailedLoginAttempts,
  getFailedLoginFailures,
  getLoginLockoutRemainingSeconds,
  isLoginRateLimited,
  logFailedLoginAttempt,
  pruneFailedLoginState,
  registerFailedLoginAttempt,
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
  const { identifier, password } = input;
  const { rateLimitKey, accountRateLimitKey, clientIp } =
    getLoginRequestContext(input.headers, identifier);
  const identifierLabel = getLoginIdentifierLogLabel(identifier);
  const now = Date.now();
  const methodLabel = isLikelyEmail(identifier) ? "email" : "username";
  const log = logger.withScope("Auth");

  log.info(
    `Password login attempt started for ${identifierLabel} from ip='${clientIp}' using ${methodLabel}.`,
  );

  const expiredLockout = clearExpiredLoginLockout(rateLimitKey, now);
  if (expiredLockout.wasCleared) {
    log.info(
      `Password login lockout expired for ${identifierLabel} from ip='${clientIp}' after ${expiredLockout.failures} failed attempt(s).`,
    );
  }
  pruneFailedLoginState(now);

  if (isLoginRateLimited(rateLimitKey, now)) {
    const remainingSeconds = getLoginLockoutRemainingSeconds(rateLimitKey, now);
    log.warn(
      `Blocked password login attempt for ${identifierLabel} from ip='${clientIp}' due to active lockout (${remainingSeconds}s remaining).`,
    );
    return { ok: false, errorKey: "error_too_many_attempts", status: 429 };
  }

  if (!identifier || !password) {
    const failedAttempt = registerFailedLoginAttempt(rateLimitKey, now);
    logFailedLoginAttempt({
      identifier,
      clientIp,
      reason: "invalid_input",
      result: failedAttempt,
      prefix: "password",
    });
    return { ok: false, errorKey: "error_invalid_credentials", status: 400 };
  }

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
    const failedAttempt = registerFailedLoginAttempt(rateLimitKey, now);
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
  const previousFailures = accountRateLimitKey
    ? getFailedLoginFailures(accountRateLimitKey)
    : 0;
  // A valid account may clear its own failure history, but must not erase the
  // shared IP bucket that protects other accounts from credential spraying.
  if (accountRateLimitKey) {
    clearFailedLoginAttempts(accountRateLimitKey);
  }

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
