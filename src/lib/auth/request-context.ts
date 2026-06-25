import type { AuthSocialProvider } from "@/lib/auth/config";

export function getClientIpFromHeaders(headerStore: Headers): string {
  const forwardedFor = headerStore.get("x-forwarded-for");
  const firstForwardedIp = forwardedFor?.split(",")[0]?.trim();
  const realIp = headerStore.get("x-real-ip")?.trim();
  return (firstForwardedIp || realIp || "unknown").slice(0, 128);
}

export function getClientIpFromRequest(request: Request | undefined): string {
  return request ? getClientIpFromHeaders(request.headers) : "unknown";
}

export function getLoginRequestContext(
  headerStore: Headers,
  identifier: string,
): {
  rateLimitKey: string;
  clientIp: string;
} {
  const ip = getClientIpFromHeaders(headerStore);
  const normalizedIdentifier = identifier.trim().toLowerCase().slice(0, 128);
  return {
    rateLimitKey: `${ip}:${normalizedIdentifier || "unknown"}`,
    clientIp: ip,
  };
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
