import { createHash } from "node:crypto";
import { isIP } from "node:net";
import type { AuthSocialProvider } from "@/lib/auth/config";

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
  if (process.env.AUTH_TRUST_PROXY_HEADERS === "false") return "unknown";

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

export function getLoginRequestContext(
  headerStore: Headers,
  identifier: string,
): {
  rateLimitKey: readonly string[];
  accountRateLimitKey: string | null;
  clientIp: string;
} {
  const ip = getClientIpFromHeaders(headerStore);
  const normalizedIdentifier = identifier.trim().toLowerCase().slice(0, 128);
  const identifierHash = createHash("sha256")
    .update(normalizedIdentifier || "unknown")
    .digest("hex");
  const accountRateLimitKey =
    ip === "unknown" ? null : `ip-identifier:${ip}:${identifierHash}`;
  return {
    rateLimitKey: [
      ...(ip === "unknown" ? [] : [`ip:${ip}`]),
      ...(accountRateLimitKey ? [accountRateLimitKey] : []),
    ],
    accountRateLimitKey,
    clientIp: ip,
  };
}

export function getLoginIdentifierLogLabel(identifier: string): string {
  const normalized = identifier.trim().toLowerCase() || "unknown";
  const hash = createHash("sha256")
    .update(normalized)
    .digest("hex")
    .slice(0, 12);
  return `identifier_hash='${hash}'`;
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
