import { randomUUID } from "node:crypto";
import { getAuthDb } from "@/lib/auth/db";
import { getLoginIdentifierLogLabel } from "@/lib/auth/request-context";
import { logger } from "@/lib/logger";

const MAX_PASSWORD_RESET_IDENTIFIER_LENGTH = 320;
const log = logger.withScope("AuthApi");

type PasswordResetUserRow = {
  email?: string | null;
};

function createUnknownAccountEmail() {
  return `password-reset-${randomUUID()}@invalid.example`;
}

function isValidStoredEmail(value: string) {
  return (
    value.length <= MAX_PASSWORD_RESET_IDENTIFIER_LENGTH &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  );
}

export function normalizePasswordResetIdentifier(identifier: unknown): string {
  if (typeof identifier !== "string") return "";
  const withoutFormatCharacters = identifier.trim().replace(/\p{Cf}/gu, "");
  const withoutEmailWhitespace = withoutFormatCharacters.includes("@")
    ? withoutFormatCharacters.replace(/\p{White_Space}/gu, "")
    : withoutFormatCharacters;
  return withoutEmailWhitespace.toLowerCase();
}

function getMaskedPasswordResetIdentifier(value: string) {
  const emailMatch = /^([^\s@]+)@([a-z0-9.-]+)$/i.exec(value);
  if (emailMatch) {
    const localPart = emailMatch[1] || "";
    const domain = emailMatch[2] || "";
    return `${localPart.slice(0, 1) || "*"}***@${domain}`;
  }
  return /^[a-z0-9]/i.test(value) ? `${value.slice(0, 1)}***` : "<invalid>";
}

function logPasswordResetIdentifierLookup(
  identifier: string,
  result: "matched" | "not_found" | "ambiguous" | "invalid_stored_email",
) {
  const type = identifier.includes("@") ? "email" : "username";
  log.debug(
    `Password reset identifier lookup result='${result}' type='${type}' masked='${getMaskedPasswordResetIdentifier(identifier)}' ${getLoginIdentifierLogLabel(identifier)}.`,
  );
}

export function resolvePasswordResetEmail(identifier: unknown): string {
  const normalizedIdentifier = normalizePasswordResetIdentifier(identifier);
  const lookupValue =
    normalizedIdentifier.length > 0 &&
    normalizedIdentifier.length <= MAX_PASSWORD_RESET_IDENTIFIER_LENGTH
      ? normalizedIdentifier
      : createUnknownAccountEmail();
  const rows = getAuthDb()
    .prepare(
      "SELECT email FROM user WHERE lower(email) = lower(?) OR lower(username) = lower(?) LIMIT 2",
    )
    .all(lookupValue, lookupValue) as PasswordResetUserRow[];

  if (rows.length !== 1) {
    logPasswordResetIdentifierLookup(
      normalizedIdentifier,
      rows.length > 1 ? "ambiguous" : "not_found",
    );
    return createUnknownAccountEmail();
  }

  const email = rows[0]?.email?.trim().toLowerCase() || "";
  if (!isValidStoredEmail(email)) {
    logPasswordResetIdentifierLookup(
      normalizedIdentifier,
      "invalid_stored_email",
    );
    return createUnknownAccountEmail();
  }
  logPasswordResetIdentifierLookup(normalizedIdentifier, "matched");
  return email;
}

export async function readPasswordResetIdentifierFromRequest(
  request: Request,
): Promise<string> {
  try {
    const payload = (await request.clone().json()) as unknown;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return "";
    }
    return normalizePasswordResetIdentifier(
      (payload as Record<string, unknown>).email,
    );
  } catch {
    return "";
  }
}

export async function rewritePasswordResetIdentifierRequest(
  request: Request,
): Promise<Request> {
  let payload: Record<string, unknown>;
  try {
    const parsed = (await request.clone().json()) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return request;
    }
    payload = parsed as Record<string, unknown>;
  } catch {
    return request;
  }

  const email = resolvePasswordResetEmail(payload.email);
  const headers = new Headers(request.headers);
  headers.delete("content-length");

  // Next.js passes a NextRequest here. Using it as the Request constructor's
  // input preserves NextRequest's private implementation state in a way that
  // can fail once Better Auth reads the rewritten request. Build a plain Web
  // Request instead and carry over only the metadata needed by the auth route.
  return new Request(request.url, {
    method: request.method,
    body: JSON.stringify({ ...payload, email }),
    headers,
    signal: request.signal,
  });
}
