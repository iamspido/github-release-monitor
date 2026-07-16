import { createHmac, timingSafeEqual } from "node:crypto";

type SignedCookieOptions = {
  secret: string;
  minSecretLength?: number;
};

type CookieHeaderOptions = {
  name: string;
  value: string | null;
  maxAge: number;
  secure?: boolean;
};

function canSign({ secret, minSecretLength = 1 }: SignedCookieOptions) {
  return secret.length >= minSecretLength;
}

function signPayload(payloadPart: string, options: SignedCookieOptions) {
  if (!canSign(options)) return "";
  return createHmac("sha256", options.secret)
    .update(payloadPart)
    .digest("base64url");
}

export function encodeSignedJsonCookieValue(
  payload: unknown,
  options: SignedCookieOptions,
): string {
  const payloadPart = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  const signature = signPayload(payloadPart, options);
  return signature ? `${payloadPart}.${signature}` : "";
}

export function decodeSignedJsonCookieValue(
  value: string | undefined | null,
  options: SignedCookieOptions,
): unknown | null {
  if (!value) return null;
  const [payloadPart, signaturePart] = value.split(".");
  if (!payloadPart || !signaturePart) return null;

  const expectedSignature = signPayload(payloadPart, options);
  if (!expectedSignature) return null;

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
    return JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export function getCookieValue(rawCookieHeader: string | null, name: string) {
  if (!rawCookieHeader) return null;
  const targetPrefix = `${name}=`;
  for (const part of rawCookieHeader.split(";")) {
    const segment = part.trim();
    if (!segment.startsWith(targetPrefix)) continue;
    return segment.slice(targetPrefix.length);
  }
  return null;
}

export function buildHttpOnlyCookieHeader({
  name,
  value,
  maxAge,
  secure = process.env.HTTPS !== "false",
}: CookieHeaderOptions): string {
  return [
    `${name}=${value ?? ""}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${value ? maxAge : 0}`,
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}
