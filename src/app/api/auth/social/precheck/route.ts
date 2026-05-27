import { NextResponse } from "next/server";
import { ensureAuthDatabaseReady, precheckSocialLogin } from "@/lib/auth";
import {
  buildSocialLoginIntentSetCookieHeader,
  buildSocialLoginIntentValue,
  type SocialLoginProvider,
} from "@/lib/auth/social-login-intent";
import { logger } from "@/lib/logger";

const log = logger.withScope("AuthSocialPrecheck");

type SocialPrecheckPayload = {
  identifier?: unknown;
  provider?: unknown;
};

function toSafeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isSupportedProvider(value: string): value is SocialLoginProvider {
  return value === "github" || value === "google";
}

function getClientIp(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const firstForwardedIp = forwardedFor?.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip")?.trim();
  return (firstForwardedIp || realIp || "unknown").slice(0, 128);
}

export async function POST(request: Request) {
  await ensureAuthDatabaseReady();
  const clientIp = getClientIp(request);

  let payload: SocialPrecheckPayload;
  try {
    payload = (await request.json()) as SocialPrecheckPayload;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const identifier = toSafeString(payload.identifier);
  const provider = toSafeString(payload.provider).toLowerCase();
  if (!isSupportedProvider(provider)) {
    return NextResponse.json({ error: "invalid_provider" }, { status: 400 });
  }

  const precheckResult = precheckSocialLogin(identifier, provider);
  if (precheckResult === "invalid_input") {
    log.warn(
      `Rejected social precheck for provider='${provider}' from ip='${clientIp}' due to missing identifier.`,
    );
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  if (precheckResult === "provider_not_configured") {
    log.warn(
      `Rejected social precheck for provider='${provider}' from ip='${clientIp}' because provider is not configured.`,
    );
    return NextResponse.json(
      { error: "provider_not_configured" },
      { status: 400 },
    );
  }

  if (precheckResult === "unknown_or_unlinked") {
    log.warn(
      `Denied social precheck for provider='${provider}' from ip='${clientIp}' (unknown or unlinked account).`,
    );
    return NextResponse.json({ canProceed: false }, { status: 200 });
  }

  const intentValue = buildSocialLoginIntentValue(provider);
  const response = NextResponse.json({ canProceed: true }, { status: 200 });
  response.headers.append(
    "set-cookie",
    buildSocialLoginIntentSetCookieHeader(intentValue),
  );
  log.info(
    `Issued social login intent for provider='${provider}' to ip='${clientIp}'.`,
  );
  return response;
}
