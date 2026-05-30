import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
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
  return (
    process.env.BETTER_AUTH_SECRET ||
    process.env.AUTH_SECRET ||
    process.env.AUTH_SETUP_TOKEN ||
    ""
  );
}

function toBase64Url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function fromBase64Url(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signPayload(payloadPart: string) {
  return createHmac("sha256", getIntentSecret())
    .update(payloadPart)
    .digest("base64url");
}

function getCookieValue(rawCookieHeader: string | null, name: string) {
  if (!rawCookieHeader) return null;
  const targetPrefix = `${name}=`;
  for (const part of rawCookieHeader.split(";")) {
    const segment = part.trim();
    if (!segment.startsWith(targetPrefix)) continue;
    return segment.slice(targetPrefix.length);
  }
  return null;
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
  const payloadPart = toBase64Url(JSON.stringify(payload));
  const signature = signPayload(payloadPart);
  return `${payloadPart}.${signature}`;
}

export function readSocialLoginIntentFromRequest(
  request: Request,
): SocialLoginIntentPayload | null {
  const encoded = getCookieValue(
    request.headers.get("cookie"),
    SOCIAL_LOGIN_INTENT_COOKIE_NAME,
  );
  if (!encoded) return null;

  const [payloadPart, signaturePart] = encoded.split(".");
  if (!payloadPart || !signaturePart) return null;

  const expectedSignature = signPayload(payloadPart);
  try {
    const valid = timingSafeEqual(
      Buffer.from(signaturePart, "utf8"),
      Buffer.from(expectedSignature, "utf8"),
    );
    if (!valid) return null;
  } catch {
    return null;
  }

  try {
    const parsed = JSON.parse(
      fromBase64Url(payloadPart),
    ) as Partial<SocialLoginIntentPayload>;

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
  const secure = process.env.HTTPS !== "false";
  const cookieValue = value ?? "";
  const maxAge = value ? SOCIAL_LOGIN_INTENT_TTL_SECONDS : 0;
  return [
    `${SOCIAL_LOGIN_INTENT_COOKIE_NAME}=${cookieValue}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
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
