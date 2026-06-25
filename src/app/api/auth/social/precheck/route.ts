import { NextResponse } from "next/server";
import { ensureAuthDatabaseReady, precheckSocialLogin } from "@/lib/auth";
import {
  getClientIpFromRequest,
  isSupportedAuthSocialProvider,
  readJsonPayload,
  toSafeString,
} from "@/lib/auth/request-context";
import {
  buildSocialLoginIntentSetCookieHeader,
  buildSocialLoginIntentValue,
} from "@/lib/auth/social-login-intent";
import { logger } from "@/lib/logger";

const log = logger.withScope("AuthSocialPrecheck");

type SocialPrecheckPayload = {
  identifier?: unknown;
  provider?: unknown;
};

export async function POST(request: Request) {
  await ensureAuthDatabaseReady();
  const clientIp = getClientIpFromRequest(request);

  const jsonResult = await readJsonPayload<SocialPrecheckPayload>(request);
  if (!jsonResult.ok) {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const payload = jsonResult.payload;

  const identifier = toSafeString(payload.identifier);
  const provider = toSafeString(payload.provider).toLowerCase();
  if (!isSupportedAuthSocialProvider(provider)) {
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
