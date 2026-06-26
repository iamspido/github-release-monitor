import { type NextRequest, NextResponse } from "next/server";
import { getAllowedGitlabHosts } from "@/lib/repositories/providers";

export function getBlockedDevOriginResponse(
  request: NextRequest,
): NextResponse | null {
  if (process.env.NODE_ENV !== "development") {
    return null;
  }
  const allowedDevOrigins = getAllowedDevOrigins();
  const origin = request.headers.get("origin");
  if (
    origin &&
    allowedDevOrigins.length > 0 &&
    !allowedDevOrigins.includes(origin)
  ) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  return null;
}

export function applySecurityHeaders(response: NextResponse): void {
  const securityHeaders = getSecurityHeaders();
  securityHeaders.forEach((header) => {
    response.headers.set(header.key, header.value);
  });
}

function getAllowedDevOrigins(): string[] {
  const allowedOriginsFromEnv = process.env.ALLOWED_DEV_ORIGINS;
  return allowedOriginsFromEnv
    ? allowedOriginsFromEnv.split(",").map((origin) => origin.trim())
    : [];
}

function getSecurityHeaders() {
  const https = process.env.HTTPS !== "false";
  const gitlabConnectSrc = getAllowedGitlabHosts().map(
    (host) => `https://${host}`,
  );
  const connectSrc = [
    "'self'",
    "https://api.github.com",
    ...gitlabConnectSrc,
  ].join(" ");

  const cspPolicies = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    // Allow `data:` image URLs for locally generated QR codes (2FA setup),
    // plus HTTPS images for release note assets.
    "img-src 'self' https: data:",
    `connect-src ${connectSrc}`,
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];

  if (https) {
    cspPolicies.push("upgrade-insecure-requests");
  }

  const cspHeader = cspPolicies.join("; ");

  return [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Content-Security-Policy", value: cspHeader },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=()",
    },
    { key: "Referrer-Policy", value: "no-referrer" },
  ];
}
