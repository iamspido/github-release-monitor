import { randomUUID } from "node:crypto";
import { getAuthSecret } from "@/lib/auth/config";
import {
  buildHttpOnlyCookieHeader,
  decodeSignedJsonCookieValue,
  encodeSignedJsonCookieValue,
  getCookieValue,
} from "@/lib/auth/signed-cookie";

export const SECRET_REVEAL_PENDING_COOKIE = "diagnostic_secret_reveal_pending";
export const SECRET_REVEAL_VERIFIED_COOKIE =
  "diagnostic_secret_reveal_verified";
export const SECRET_REVEAL_STEP_UP_TTL_SECONDS = 5 * 60;

export type SecretRevealStepUpMethod =
  | "password"
  | "totp"
  | "passkey"
  | "social";
export type SecretRevealSocialProvider = "github" | "google";
export type SecretRevealTarget = "mail_password" | "apprise_url";

export type SecretRevealStepUpCookiePayload = {
  userId: string;
  method: SecretRevealStepUpMethod;
  provider?: SecretRevealSocialProvider;
  target: SecretRevealTarget;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
};

function getStepUpSecret() {
  return getAuthSecret();
}

export function createSecretRevealStepUpPayload(args: {
  userId: string;
  method: SecretRevealStepUpMethod;
  provider?: SecretRevealSocialProvider;
  target?: SecretRevealTarget;
}): SecretRevealStepUpCookiePayload {
  const now = Date.now();
  return {
    userId: args.userId,
    method: args.method,
    ...(args.provider ? { provider: args.provider } : {}),
    target: args.target ?? "mail_password",
    issuedAt: now,
    expiresAt: now + SECRET_REVEAL_STEP_UP_TTL_SECONDS * 1_000,
    nonce: randomUUID(),
  };
}

export function encodeSecretRevealStepUpCookieValue(
  payload: SecretRevealStepUpCookiePayload,
) {
  return encodeSignedJsonCookieValue(payload, {
    secret: getStepUpSecret(),
    minSecretLength: 32,
  });
}

export function decodeSecretRevealStepUpCookieValue(
  value: string | undefined | null,
) {
  try {
    const parsed = decodeSignedJsonCookieValue(value, {
      secret: getStepUpSecret(),
      minSecretLength: 32,
    }) as Partial<SecretRevealStepUpCookiePayload> | null;
    if (!parsed) return null;
    if (
      typeof parsed.userId !== "string" ||
      !parsed.userId ||
      (parsed.method !== "password" &&
        parsed.method !== "totp" &&
        parsed.method !== "passkey" &&
        parsed.method !== "social") ||
      typeof parsed.issuedAt !== "number" ||
      !Number.isFinite(parsed.issuedAt) ||
      typeof parsed.expiresAt !== "number" ||
      !Number.isFinite(parsed.expiresAt) ||
      typeof parsed.nonce !== "string" ||
      !parsed.nonce ||
      Date.now() > parsed.expiresAt
    ) {
      return null;
    }
    if (
      parsed.provider &&
      parsed.provider !== "github" &&
      parsed.provider !== "google"
    ) {
      return null;
    }
    if (
      parsed.target !== undefined &&
      parsed.target !== "mail_password" &&
      parsed.target !== "apprise_url"
    ) {
      return null;
    }
    return {
      ...(parsed as Omit<SecretRevealStepUpCookiePayload, "target">),
      // Accept cookies issued by the previous v2 implementation until their
      // five-minute TTL expires.
      target: parsed.target ?? "mail_password",
    };
  } catch {
    return null;
  }
}

function buildSecretRevealStepUpSetCookieHeader(
  name: string,
  payload: SecretRevealStepUpCookiePayload | null,
) {
  return buildHttpOnlyCookieHeader({
    name,
    value: payload ? encodeSecretRevealStepUpCookieValue(payload) : null,
    maxAge: SECRET_REVEAL_STEP_UP_TTL_SECONDS,
  });
}

export function buildSecretRevealPendingSetCookieHeader(
  payload: SecretRevealStepUpCookiePayload | null,
) {
  return buildSecretRevealStepUpSetCookieHeader(
    SECRET_REVEAL_PENDING_COOKIE,
    payload,
  );
}

export function buildSecretRevealVerifiedSetCookieHeader(
  payload: SecretRevealStepUpCookiePayload | null,
) {
  return buildSecretRevealStepUpSetCookieHeader(
    SECRET_REVEAL_VERIFIED_COOKIE,
    payload,
  );
}

export function readSecretRevealPendingFromRequest(request: Request) {
  return decodeSecretRevealStepUpCookieValue(
    getCookieValue(request.headers.get("cookie"), SECRET_REVEAL_PENDING_COOKIE),
  );
}

export async function setSecretRevealStepUpCookie(
  name: string,
  payload: SecretRevealStepUpCookiePayload | null,
) {
  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();
  if (!payload) {
    cookieStore.set(name, "", getSecretRevealStepUpCookieOptions(0));
    return;
  }
  const encoded = encodeSecretRevealStepUpCookieValue(payload);
  if (!encoded) return;
  cookieStore.set(
    name,
    encoded,
    getSecretRevealStepUpCookieOptions(SECRET_REVEAL_STEP_UP_TTL_SECONDS),
  );
}

export async function readSecretRevealStepUpCookie(name: string) {
  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();
  return decodeSecretRevealStepUpCookieValue(cookieStore.get(name)?.value);
}

function getSecretRevealStepUpCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.HTTPS !== "false",
    path: "/",
    maxAge,
  };
}
