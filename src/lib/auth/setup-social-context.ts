import { createHmac, timingSafeEqual } from "node:crypto";

const SETUP_SOCIAL_COOKIE_NAME = "auth_setup_social_context";
const SETUP_SOCIAL_TTL_SECONDS = 10 * 60;

type SetupSocialContextPayload = {
  username: string;
  name?: string;
  issuedAt: number;
  expiresAt: number;
};

function getSetupSocialSecret() {
  const secret =
    process.env.BETTER_AUTH_SECRET ||
    process.env.AUTH_SECRET ||
    process.env.AUTH_SETUP_TOKEN ||
    "";
  return secret;
}

function toBase64Url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function fromBase64Url(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signPayload(payloadPart: string) {
  return createHmac("sha256", getSetupSocialSecret())
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
  const payloadPart = toBase64Url(JSON.stringify(payload));
  const signature = signPayload(payloadPart);
  return `${payloadPart}.${signature}`;
}

export function readSetupSocialContextFromRequest(
  request: Request,
): SetupSocialContextPayload | null {
  const encoded = getCookieValue(
    request.headers.get("cookie"),
    SETUP_SOCIAL_COOKIE_NAME,
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
    ) as Partial<SetupSocialContextPayload>;
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
  const secure = process.env.HTTPS !== "false";
  const cookieValue = value ?? "";
  const maxAge = value ? SETUP_SOCIAL_TTL_SECONDS : 0;
  return [
    `${SETUP_SOCIAL_COOKIE_NAME}=${cookieValue}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}
