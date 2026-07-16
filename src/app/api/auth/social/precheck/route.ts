import { NextResponse } from "next/server";
import { isSocialProviderConfigured } from "@/lib/auth";
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

  if (!identifier) {
    log.warn(
      `Rejected social precheck for provider='${provider}' from ip='${clientIp}' due to missing identifier.`,
    );
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  if (!isSocialProviderConfigured(provider)) {
    log.warn(
      `Rejected social precheck for provider='${provider}' from ip='${clientIp}' because provider is not configured.`,
    );
    return NextResponse.json(
      { error: "provider_not_configured" },
      { status: 400 },
    );
  }

  const intentValue = buildSocialLoginIntentValue(provider);
  const response = NextResponse.json({ canProceed: true }, { status: 200 });
  response.headers.append(
    "set-cookie",
    buildSocialLoginIntentSetCookieHeader(intentValue),
  );
  log.info(
    `Issued social login intent for provider='${provider}' to ip='${clientIp}' without disclosing account linkage.`,
  );
  return response;
}
