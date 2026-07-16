import { getAuthCookieSecret } from "@/lib/auth/config";
import {
  buildHttpOnlyCookieHeader,
  decodeSignedJsonCookieValue,
  encodeSignedJsonCookieValue,
  getCookieValue,
} from "@/lib/auth/signed-cookie";

const SETUP_SOCIAL_COOKIE_NAME = "auth_setup_social_context";
const SETUP_SOCIAL_TTL_SECONDS = 10 * 60;

type SetupSocialContextPayload = {
  username: string;
  name?: string;
  issuedAt: number;
  expiresAt: number;
};

function getSetupSocialSecret() {
  return getAuthCookieSecret();
}

export function buildSetupSocialContextValue(input: {
  username: string;
  name?: string;
}) {
  const now = Date.now();
  const payload: SetupSocialContextPayload = {
    username: input.username.trim(),
    name: input.name?.trim() || undefined,
    issuedAt: now,
    expiresAt: now + SETUP_SOCIAL_TTL_SECONDS * 1_000,
  };
  return encodeSignedJsonCookieValue(payload, {
    secret: getSetupSocialSecret(),
  });
}

export function readSetupSocialContextFromRequest(
  request: Request,
): SetupSocialContextPayload | null {
  const encoded = getCookieValue(
    request.headers.get("cookie"),
    SETUP_SOCIAL_COOKIE_NAME,
  );
  if (!encoded) return null;

  try {
    const parsed = decodeSignedJsonCookieValue(encoded, {
      secret: getSetupSocialSecret(),
    }) as Partial<SetupSocialContextPayload> | null;
    if (!parsed) return null;
    const username = typeof parsed.username === "string" ? parsed.username : "";
    const issuedAt =
      typeof parsed.issuedAt === "number" ? parsed.issuedAt : Number.NaN;
    const expiresAt =
      typeof parsed.expiresAt === "number" ? parsed.expiresAt : Number.NaN;
    const name =
      typeof parsed.name === "string" && parsed.name.trim()
        ? parsed.name.trim()
        : undefined;

    if (!username.trim()) return null;
    if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)) return null;
    if (Date.now() > expiresAt) return null;

    return {
      username: username.trim(),
      name,
      issuedAt,
      expiresAt,
    };
  } catch {
    return null;
  }
}

export function buildSetupSocialContextSetCookieHeader(
  value: string | null,
): string {
  return buildHttpOnlyCookieHeader({
    name: SETUP_SOCIAL_COOKIE_NAME,
    value,
    maxAge: SETUP_SOCIAL_TTL_SECONDS,
  });
}
