import { createHash } from "node:crypto";
import { isIP } from "node:net";
import type { AuthSocialProvider } from "@/lib/auth/config";
import { logger } from "@/lib/logger";

let proxyCompatibilityWarningShown = false;

function normalizeIpCandidate(value: string | undefined): string | null {
  const candidate = value?.trim();
  if (!candidate) return null;
  if (isIP(candidate)) return candidate;

  const ipv4WithPort = candidate.match(/^(.+):(\d+)$/)?.[1];
  return ipv4WithPort && isIP(ipv4WithPort) ? ipv4WithPort : null;
}

function getTrustedProxyHops(): number {
  const parsed = Number.parseInt(
    process.env.AUTH_TRUSTED_PROXY_HOPS ?? "1",
    10,
  );
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 10) : 1;
}

export function getClientIpFromHeaders(headerStore: Headers): string {
  const proxySetting = process.env.AUTH_TRUST_PROXY_HEADERS;
  if (
    proxySetting !== "true" &&
    proxySetting !== "false" &&
    !proxyCompatibilityWarningShown
  ) {
    proxyCompatibilityWarningShown = true;
    logger
      .withScope("Auth")
      .warn(
        "AUTH_TRUST_PROXY_HEADERS is unset or invalid; preserving the 2.x compatibility default and trusting proxy client-address headers. Set it explicitly to true only behind a trusted proxy, or false for direct exposure. The default will become false in the next major release.",
      );
  }
  if (proxySetting === "false") return "unknown";

  const forwardedIps = (headerStore.get("x-forwarded-for") ?? "")
    .split(",")
    .map((value) => normalizeIpCandidate(value))
    .filter((value): value is string => value !== null);
  const forwardedIp = forwardedIps.at(-getTrustedProxyHops());
  const realIp = normalizeIpCandidate(
    headerStore.get("x-real-ip") ?? undefined,
  );
  return forwardedIp || realIp || "unknown";
}

export function getClientIpFromRequest(request: Request | undefined): string {
  return request ? getClientIpFromHeaders(request.headers) : "unknown";
}

export function getExplicitlyTrustedClientIpFromRequest(
  request: Request | undefined,
): string {
  if (process.env.AUTH_TRUST_PROXY_HEADERS !== "true") return "unknown";
  return getClientIpFromRequest(request);
}

export const ACCOUNT_RATE_LIMIT_KEY_PREFIX = "account:";

// Hashes the whole value: a shared prefix must not share buckets (CWE-307).
function hashLoginIdentifier(identifier: string): string {
  return createHash("sha256")
    .update(identifier.trim().toLowerCase() || "unknown")
    .digest("hex");
}

export function getLoginRequestContext(
  headerStore: Headers,
  identifier: string,
): {
  rateLimitKey: readonly string[];
  accountRateLimitKey: string | null;
  accountWideRateLimitKey: string;
  clientIp: string;
} {
  const ip = getClientIpFromHeaders(headerStore);
  const identifierHash = hashLoginIdentifier(identifier);
  // Clients may choose or omit their address, so an entered identifier also has
  // a bucket for all addresses (CWE-307), keyed by input not account (CWE-204).
  const accountWideRateLimitKey = `${ACCOUNT_RATE_LIMIT_KEY_PREFIX}${identifierHash}`;
  if (ip === "unknown") {
    // Requests without an address share this bucket at the per-address limit.
    const accountRateLimitKey = `identifier:${identifierHash}`;
    return {
      rateLimitKey: [accountRateLimitKey, accountWideRateLimitKey],
      accountRateLimitKey,
      accountWideRateLimitKey,
      clientIp: ip,
    };
  }
  const accountRateLimitKey = `ip-identifier:${ip}:${identifierHash}`;
  return {
    rateLimitKey: [`ip:${ip}`, accountRateLimitKey, accountWideRateLimitKey],
    accountRateLimitKey,
    accountWideRateLimitKey,
    clientIp: ip,
  };
}

export function getLoginIdentifierLogLabel(identifier: string): string {
  return `identifier_hash='${hashLoginIdentifier(identifier).slice(0, 12)}'`;
}

export function isLikelyEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function toSafeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function isSupportedAuthSocialProvider(
  value: string | null | undefined,
): value is AuthSocialProvider {
  return value === "github" || value === "google";
}

export async function readJsonPayload<T>(
  request: Request,
): Promise<{ ok: true; payload: T } | { ok: false }> {
  try {
    return { ok: true, payload: (await request.json()) as T };
  } catch {
    return { ok: false };
  }
}
