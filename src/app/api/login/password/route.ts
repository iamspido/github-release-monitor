import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { auth, ensureAuthDatabaseReady } from "@/lib/auth";
import { logger } from "@/lib/logger";

type LoginPayload = {
  identifier?: unknown;
  password?: unknown;
  next?: unknown;
  locale?: unknown;
};

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

declare global {
  var _passwordLoginAttempts: Map<string, LoginAttemptState> | undefined;
}

global._passwordLoginAttempts ??= new Map<string, LoginAttemptState>();
const failedLoginAttempts = global._passwordLoginAttempts as Map<
  string,
  LoginAttemptState
>;

const DEFAULT_LOGIN_ATTEMPTS = 5;
const DEFAULT_ATTEMPT_WINDOW_SECONDS = 15 * 60;
const DEFAULT_LOCKOUT_SECONDS = 15 * 60;
const validLocales = new Set(["en", "de"]);

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

function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const firstForwardedIp = forwardedFor?.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip")?.trim();
  return (firstForwardedIp || realIp || "unknown").slice(0, 128);
}

function isLikelyEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function normalizeLocale(value: unknown) {
  if (typeof value !== "string") return "en";
  const locale = value.trim().toLowerCase();
  return validLocales.has(locale) ? locale : "en";
}

function getLoginRequestContext(
  request: Request,
  identifier: string,
): {
  rateLimitKey: string;
  clientIp: string;
} {
  const ip = getClientIp(request);
  const normalizedIdentifier = identifier.trim().toLowerCase().slice(0, 128);
  return {
    rateLimitKey: `${ip}:${normalizedIdentifier || "unknown"}`,
    clientIp: ip,
  };
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
        `Failed password login attempt for identifier='${identifier}' from ip='${clientIp}' (${reasonLabel}); lockout activated for ${result.lockoutRemainingSeconds}s after ${result.failures}/${loginAttemptLimit} failed attempts.`,
      );
    return;
  }

  logger
    .withScope("Auth")
    .warn(
      `Failed password login attempt for identifier='${identifier}' from ip='${clientIp}' (${reasonLabel}); attempts=${result.failures}/${loginAttemptLimit}, remaining_before_lockout=${result.attemptsRemaining}.`,
    );
}

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

function getSetCookieHeaders(headers: Headers): string[] {
  const headersWithSetCookie = headers as Headers & {
    getSetCookie?: () => string[];
  };
  if (typeof headersWithSetCookie.getSetCookie === "function") {
    return headersWithSetCookie.getSetCookie();
  }
  const single = headers.get("set-cookie");
  return single ? [single] : [];
}

function attachSetCookieHeaders(response: NextResponse, source: Response) {
  for (const cookie of getSetCookieHeaders(source.headers)) {
    response.headers.append("set-cookie", cookie);
  }
}

function normalizeRedirectPath(next: unknown, locale: string) {
  if (
    typeof next !== "string" ||
    !next.startsWith("/") ||
    next.startsWith("//") ||
    next.includes("..")
  ) {
    return "";
  }

  const pathWithoutLocale = next.startsWith(`/${locale}`)
    ? next.substring(`/${locale}`.length)
    : next;
  const normalized = pathWithoutLocale.startsWith("/")
    ? pathWithoutLocale
    : `/${pathWithoutLocale}`;
  return normalized === "/" ? "" : normalized;
}

export async function POST(request: Request) {
  let payload: LoginPayload;
  try {
    payload = (await request.json()) as LoginPayload;
  } catch {
    return NextResponse.json(
      { errorKey: "error_invalid_credentials" },
      { status: 400 },
    );
  }

  const identifier =
    typeof payload.identifier === "string" ? payload.identifier.trim() : "";
  const password = typeof payload.password === "string" ? payload.password : "";
  const locale = normalizeLocale(payload.locale);
  const { rateLimitKey, clientIp } = getLoginRequestContext(
    request,
    identifier,
  );
  const now = Date.now();
  const methodLabel = isLikelyEmail(identifier) ? "email" : "username";

  logger
    .withScope("Auth")
    .info(
      `Password login attempt started for identifier='${identifier || "unknown"}' from ip='${clientIp}' using ${methodLabel}.`,
    );

  pruneFailedLoginState(now);
  if (isRateLimited(rateLimitKey, now)) {
    const remainingSeconds = getLockoutRemainingSeconds(rateLimitKey, now);
    logger
      .withScope("Auth")
      .warn(
        `Blocked password login attempt for identifier='${identifier || "unknown"}' from ip='${clientIp}' due to active lockout (${remainingSeconds}s remaining).`,
      );
    return NextResponse.json(
      { errorKey: "error_too_many_attempts" },
      { status: 429 },
    );
  }

  if (!identifier || !password) {
    const failedAttempt = registerFailedAttempt(rateLimitKey, now);
    logFailedLoginAttempt(
      identifier || "unknown",
      clientIp,
      "invalid_input",
      failedAttempt,
    );
    return NextResponse.json(
      { errorKey: "error_invalid_credentials" },
      { status: 400 },
    );
  }

  await ensureAuthDatabaseReady();
  const signInResponse =
    methodLabel === "email"
      ? await auth.api.signInEmail({
          headers: request.headers,
          body: { email: identifier.toLowerCase(), password },
          asResponse: true,
        })
      : await auth.api.signInUsername({
          headers: request.headers,
          body: { username: identifier, password },
          asResponse: true,
        });

  if (!signInResponse.ok) {
    const failedAttempt = registerFailedAttempt(rateLimitKey, now);
    logger
      .withScope("Auth")
      .warn(
        `Password login rejected for identifier='${identifier}' from ip='${clientIp}' with status=${signInResponse.status}.`,
      );
    logFailedLoginAttempt(
      identifier,
      clientIp,
      "invalid_credentials",
      failedAttempt,
    );
    return NextResponse.json(
      {
        errorKey: failedAttempt.lockoutTriggered
          ? "error_too_many_attempts"
          : "error_invalid_credentials",
      },
      { status: signInResponse.status || 401 },
    );
  }

  clearFailedAttempts(rateLimitKey);
  const twoFactorRequired = await hasTwoFactorRedirectFlag(signInResponse);
  if (twoFactorRequired) {
    const response = NextResponse.json({ requiresTwoFactor: true });
    attachSetCookieHeaders(response, signInResponse);
    return response;
  }

  const finalPath = normalizeRedirectPath(payload.next, locale);
  logger
    .withScope("Auth")
    .info(
      `Password login completed; client will navigate to '${finalPath}' (locale=${locale}).`,
    );
  revalidatePath("/", "layout");
  const response = NextResponse.json({ redirectTo: `/${locale}${finalPath}` });
  attachSetCookieHeaders(response, signInResponse);
  return response;
}
