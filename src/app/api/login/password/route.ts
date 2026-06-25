import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { auth, ensureAuthDatabaseReady } from "@/lib/auth";
import {
  clearFailedLoginAttempts,
  getLoginLockoutRemainingSeconds,
  isLoginRateLimited,
  logFailedLoginAttempt,
  pruneFailedLoginState,
  registerFailedLoginAttempt,
} from "@/lib/auth/login-rate-limit";
import {
  getLoginRequestContext,
  isLikelyEmail,
  readJsonPayload,
  toSafeString,
} from "@/lib/auth/request-context";
import { logger } from "@/lib/logger";

type LoginPayload = {
  identifier?: unknown;
  password?: unknown;
  next?: unknown;
  locale?: unknown;
};

const validLocales = new Set(["en", "de"]);

function normalizeLocale(value: unknown) {
  if (typeof value !== "string") return "en";
  const locale = value.trim().toLowerCase();
  return validLocales.has(locale) ? locale : "en";
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
  const jsonResult = await readJsonPayload<LoginPayload>(request);
  if (!jsonResult.ok) {
    return NextResponse.json(
      { errorKey: "error_invalid_credentials" },
      { status: 400 },
    );
  }
  const payload = jsonResult.payload;

  const identifier = toSafeString(payload.identifier);
  const password = typeof payload.password === "string" ? payload.password : "";
  const locale = normalizeLocale(payload.locale);
  const { rateLimitKey, clientIp } = getLoginRequestContext(
    request.headers,
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
  if (isLoginRateLimited(rateLimitKey, now)) {
    const remainingSeconds = getLoginLockoutRemainingSeconds(rateLimitKey, now);
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
    const failedAttempt = registerFailedLoginAttempt(rateLimitKey, now);
    logFailedLoginAttempt({
      identifier: identifier || "unknown",
      clientIp,
      reason: "invalid_input",
      result: failedAttempt,
      prefix: "password",
    });
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
    const failedAttempt = registerFailedLoginAttempt(rateLimitKey, now);
    logger
      .withScope("Auth")
      .warn(
        `Password login rejected for identifier='${identifier}' from ip='${clientIp}' with status=${signInResponse.status}.`,
      );
    logFailedLoginAttempt({
      identifier,
      clientIp,
      reason: "invalid_credentials",
      result: failedAttempt,
      prefix: "password",
    });
    return NextResponse.json(
      {
        errorKey: failedAttempt.lockoutTriggered
          ? "error_too_many_attempts"
          : "error_invalid_credentials",
      },
      { status: signInResponse.status || 401 },
    );
  }

  clearFailedLoginAttempts(rateLimitKey);
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
