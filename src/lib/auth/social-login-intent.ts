import { randomUUID } from "node:crypto";
import { getAuthCookieSecret } from "@/lib/auth/config";
import {
  buildHttpOnlyCookieHeader,
  decodeSignedJsonCookieValue,
  encodeSignedJsonCookieValue,
  getCookieValue,
} from "@/lib/auth/signed-cookie";
import { isUsernamePolicyValid } from "@/lib/username-policy";

const SOCIAL_LOGIN_INTENT_COOKIE_NAME = "auth_social_login_intent";
const SOCIAL_LOGIN_INTENT_TTL_SECONDS = 2 * 60;

export type SocialLoginProvider = "github" | "google";

type SocialLoginIntentPayload = {
  provider: SocialLoginProvider;
  purpose: "login" | "register";
  issuedAt: number;
  expiresAt: number;
  nonce: string;
  username?: string;
  email?: string;
};

function getIntentSecret() {
  return getAuthCookieSecret();
}

function isSupportedProvider(
  value: string | null | undefined,
): value is SocialLoginProvider {
  return value === "github" || value === "google";
}

export function buildSocialLoginIntentValue(
  provider: SocialLoginProvider,
  options?: {
    purpose?: "login" | "register";
    username?: string;
    email?: string;
  },
) {
  const now = Date.now();
  const purpose = options?.purpose || "login";
  const payload: SocialLoginIntentPayload = {
    provider,
    purpose,
    issuedAt: now,
    expiresAt: now + SOCIAL_LOGIN_INTENT_TTL_SECONDS * 1_000,
    nonce: randomUUID(),
  };
  if (purpose === "register") {
    payload.username = options?.username?.trim();
    payload.email = options?.email?.trim().toLowerCase();
  }
  return encodeSignedJsonCookieValue(payload, {
    secret: getIntentSecret(),
  });
}

export function readSocialLoginIntentFromRequest(
  request: Request,
): SocialLoginIntentPayload | null {
  const encoded = getCookieValue(
    request.headers.get("cookie"),
    SOCIAL_LOGIN_INTENT_COOKIE_NAME,
  );
  if (!encoded) return null;

  try {
    const parsed = decodeSignedJsonCookieValue(encoded, {
      secret: getIntentSecret(),
    }) as Partial<SocialLoginIntentPayload> | null;
    if (!parsed) return null;

    if (!isSupportedProvider(parsed.provider)) return null;
    const purpose = parsed.purpose === "register" ? "register" : "login";
    if (
      typeof parsed.issuedAt !== "number" ||
      !Number.isFinite(parsed.issuedAt) ||
      typeof parsed.expiresAt !== "number" ||
      !Number.isFinite(parsed.expiresAt) ||
      typeof parsed.nonce !== "string" ||
      !parsed.nonce
    ) {
      return null;
    }
    if (Date.now() > parsed.expiresAt) return null;
    const username =
      typeof parsed.username === "string" ? parsed.username.trim() : "";
    const email =
      typeof parsed.email === "string" ? parsed.email.trim().toLowerCase() : "";
    if (purpose === "register" && !isUsernamePolicyValid(username)) {
      return null;
    }

    return {
      provider: parsed.provider,
      purpose,
      issuedAt: parsed.issuedAt,
      expiresAt: parsed.expiresAt,
      nonce: parsed.nonce,
      ...(purpose === "register" ? { username, email } : {}),
    };
  } catch {
    return null;
  }
}

export function buildSocialLoginIntentSetCookieHeader(
  value: string | null,
): string {
  return buildHttpOnlyCookieHeader({
    name: SOCIAL_LOGIN_INTENT_COOKIE_NAME,
    value,
    maxAge: SOCIAL_LOGIN_INTENT_TTL_SECONDS,
  });
}

export async function setSocialLoginIntentCookie(value: string | null) {
  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();
  const maxAge = value ? SOCIAL_LOGIN_INTENT_TTL_SECONDS : 0;
  cookieStore.set(SOCIAL_LOGIN_INTENT_COOKIE_NAME, value ?? "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.HTTPS !== "false",
    path: "/",
    maxAge,
  });
}
