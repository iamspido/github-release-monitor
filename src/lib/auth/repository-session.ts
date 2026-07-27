import { getAuthDb } from "@/lib/auth/db";
import { isSqliteMissingColumnError } from "@/lib/auth/repository-schema";
import { logger } from "@/lib/logger";

const log = logger.withScope("Auth");

export type AuthUserExistence = "has_user" | "no_user" | "unknown";

export function hasAnyAuthUser(): AuthUserExistence {
  try {
    const row = getAuthDb().prepare("SELECT id FROM user LIMIT 1").get();
    log.debug(`Auth user existence check result: ${Boolean(row)}.`);
    return row ? "has_user" : "no_user";
  } catch (error) {
    log.error(
      "Auth user existence check failed; setup-related flows will fail closed.",
      error,
    );
    return "unknown";
  }
}

function getCookieValue(rawCookieHeader: string | null, name: string) {
  if (!rawCookieHeader) return null;
  const targetPrefix = `${name}=`;
  for (const part of rawCookieHeader.split(";")) {
    const segment = part.trim();
    if (segment.startsWith(targetPrefix)) {
      return segment.slice(targetPrefix.length);
    }
  }
  return null;
}

function parseExpiryTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;

  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function hasValidAuthSessionForRequest(request: Request) {
  const rawCookieHeader = request.headers.get("cookie");
  const rawToken =
    getCookieValue(rawCookieHeader, "better-auth.session_token") ||
    getCookieValue(rawCookieHeader, "__Secure-better-auth.session_token");
  if (!rawToken) return false;

  let token: string;
  try {
    token = decodeURIComponent(rawToken.trim());
  } catch {
    return false;
  }
  if (!token) return false;

  const queries = [
    "SELECT userId, expiresAt FROM session WHERE token = ? LIMIT 1",
    "SELECT user_id, expires_at FROM session WHERE token = ? LIMIT 1",
  ] as const;

  for (const query of queries) {
    try {
      const row = getAuthDb().prepare(query).get(token) as
        | {
            userId?: string | null;
            user_id?: string | null;
            expiresAt?: string | number | null;
            expires_at?: string | number | null;
          }
        | undefined;
      if (!row) continue;

      const userId = String(row.userId || row.user_id || "").trim();
      if (!userId) continue;

      const expiresAtMs = parseExpiryTimestamp(
        row.expiresAt ?? row.expires_at ?? null,
      );
      if (typeof expiresAtMs !== "number" || expiresAtMs <= Date.now()) {
        return false;
      }
      return true;
    } catch (error) {
      if (isSqliteMissingColumnError(error)) continue;
      log.error(
        "Failed to validate Better Auth session token from request.",
        error,
      );
      return false;
    }
  }

  return false;
}
