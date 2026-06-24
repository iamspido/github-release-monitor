export function getClientIpFromHeaders(headerStore: Headers): string {
  const forwardedFor = headerStore.get("x-forwarded-for");
  const firstForwardedIp = forwardedFor?.split(",")[0]?.trim();
  const realIp = headerStore.get("x-real-ip")?.trim();
  return (firstForwardedIp || realIp || "unknown").slice(0, 128);
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
