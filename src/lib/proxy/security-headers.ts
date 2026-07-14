import { type NextRequest, NextResponse } from "next/server";
import { getAllowedGitlabHosts } from "@/lib/repositories/providers";

export type RequestSecurityContext = {
  contentSecurityPolicy: string;
  nonce: string;
};

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

export function createRequestSecurityContext(): RequestSecurityContext {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  return {
    nonce,
    contentSecurityPolicy: getContentSecurityPolicy(nonce),
  };
}

export function applySecurityHeaders(
  response: NextResponse,
  context: RequestSecurityContext,
): void {
  const securityHeaders = getSecurityHeaders(context.contentSecurityPolicy);
  securityHeaders.forEach((header) => {
    response.headers.set(header.key, header.value);
  });
}

/**
 * Makes the nonce-bearing CSP available to Next.js while it renders the
 * request. Next.js reads this request header and applies the nonce to its own
 * framework scripts and styles. The temporary response is created through the
 * public API so Next.js remains responsible for encoding request overrides.
 */
export function forwardSecurityContext(
  request: NextRequest,
  response: NextResponse,
  context: RequestSecurityContext,
): void {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", context.nonce);
  requestHeaders.set("Content-Security-Policy", context.contentSecurityPolicy);

  const forwardingResponse = NextResponse.next({
    request: { headers: requestHeaders },
  });
  const overrideHeader = "x-middleware-override-headers";
  const overrideNames = new Set(
    response.headers
      .get(overrideHeader)
      ?.split(",")
      .map((name) => name.trim())
      .filter(Boolean) ?? [],
  );
  for (const [name, value] of forwardingResponse.headers) {
    if (name === overrideHeader) {
      for (const overrideName of value.split(",")) {
        if (overrideName) overrideNames.add(overrideName);
      }
    } else if (name.startsWith("x-middleware-request-")) {
      response.headers.set(name, value);
    }
  }
  response.headers.set(overrideHeader, Array.from(overrideNames).join(","));
}

function getAllowedDevOrigins(): string[] {
  const allowedOriginsFromEnv = process.env.ALLOWED_DEV_ORIGINS;
  return allowedOriginsFromEnv
    ? allowedOriginsFromEnv.split(",").map((origin) => origin.trim())
    : [];
}

function getContentSecurityPolicy(nonce: string): string {
  const https = process.env.HTTPS !== "false";
  const isDevelopment = process.env.NODE_ENV === "development";
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
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${
      isDevelopment ? " 'unsafe-eval'" : ""
    }`,
    `style-src 'self' 'nonce-${nonce}'${
      isDevelopment ? " 'unsafe-inline'" : ""
    }`,
    // React style props are used for user-selected highlight colors. Keeping
    // style attributes enabled does not permit script execution, while style
    // elements still require the request nonce in production.
    "style-src-attr 'unsafe-inline'",
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

  return cspPolicies.join("; ");
}

function getSecurityHeaders(contentSecurityPolicy: string) {
  return [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Content-Security-Policy", value: contentSecurityPolicy },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=()",
    },
    { key: "Referrer-Policy", value: "no-referrer" },
  ];
}
