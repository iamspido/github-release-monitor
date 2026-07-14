import { NextResponse } from "next/server";
import {
  ensureAuthDatabaseReady,
  findRegistrationConflict,
  isSignupEnabled,
  isSocialProviderConfigured,
} from "@/lib/auth";
import {
  getClientIpFromRequest,
  getLoginIdentifierLogLabel,
  isLikelyEmail,
  isSupportedAuthSocialProvider,
  readJsonPayload,
  toSafeString,
} from "@/lib/auth/request-context";
import {
  buildSocialLoginIntentSetCookieHeader,
  buildSocialLoginIntentValue,
} from "@/lib/auth/social-login-intent";
import { logger } from "@/lib/logger";
import { isUsernamePolicyValid } from "@/lib/username-policy";

type RegisterSocialPrecheckPayload = {
  provider?: unknown;
  username?: unknown;
  email?: unknown;
};

const log = logger.withScope("AuthRegisterSocialPrecheck");

function isValidUsername(value: string) {
  return isUsernamePolicyValid(value);
}

export async function POST(request: Request) {
  await ensureAuthDatabaseReady();
  const clientIp = getClientIpFromRequest(request);

  if (!isSignupEnabled()) {
    log.warn(
      `Rejected register social precheck from ip='${clientIp}' because signup is disabled.`,
    );
    return NextResponse.json({ error: "signup_disabled" }, { status: 403 });
  }

  const jsonResult =
    await readJsonPayload<RegisterSocialPrecheckPayload>(request);
  if (!jsonResult.ok) {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const payload = jsonResult.payload;

  const provider = toSafeString(payload.provider).toLowerCase();
  const username = toSafeString(payload.username);
  const email = toSafeString(payload.email).toLowerCase();

  if (!isSupportedAuthSocialProvider(provider)) {
    return NextResponse.json({ error: "invalid_provider" }, { status: 400 });
  }

  if (!isSocialProviderConfigured(provider)) {
    return NextResponse.json(
      { error: "provider_not_configured" },
      { status: 400 },
    );
  }

  if (!isValidUsername(username)) {
    return NextResponse.json({ error: "invalid_username" }, { status: 400 });
  }

  if (email && !isLikelyEmail(email)) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }

  const registrationConflict = findRegistrationConflict(username, email);
  if (registrationConflict !== "none") {
    const usernameLabel = getLoginIdentifierLogLabel(username);
    const emailLabel = email
      ? getLoginIdentifierLogLabel(email)
      : "email_hash='none'";
    log.info(
      `Denied register social precheck for provider='${provider}' ${usernameLabel} ${emailLabel} from ip='${clientIp}' due to conflict='${registrationConflict}'.`,
    );
    return NextResponse.json(
      { canProceed: false, error: registrationConflict },
      { status: 200 },
    );
  }

  log.info(
    `Allowed register social precheck for provider='${provider}' ${getLoginIdentifierLogLabel(username)} from ip='${clientIp}'.`,
  );
  const response = NextResponse.json({ canProceed: true }, { status: 200 });
  const intentValue = buildSocialLoginIntentValue(provider, {
    purpose: "register",
    username,
    email,
  });
  response.headers.append(
    "set-cookie",
    buildSocialLoginIntentSetCookieHeader(intentValue),
  );
  return response;
}
