import { NextResponse } from "next/server";
import {
  ensureAuthDatabaseReady,
  findRegistrationConflict,
  isSignupEnabled,
  isSocialProviderConfigured,
} from "@/lib/auth";
import {
  buildSocialLoginIntentSetCookieHeader,
  buildSocialLoginIntentValue,
} from "@/lib/auth/social-login-intent";
import { logger } from "@/lib/logger";
import { isUsernamePolicyValid } from "@/lib/username-policy";

type SocialProvider = "github" | "google";

type RegisterSocialPrecheckPayload = {
  provider?: unknown;
  username?: unknown;
  email?: unknown;
};

const log = logger.withScope("AuthRegisterSocialPrecheck");

function toSafeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isSupportedProvider(value: string): value is SocialProvider {
  return value === "github" || value === "google";
}

function isLikelyEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isValidUsername(value: string) {
  return isUsernamePolicyValid(value);
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

  if (!isSignupEnabled()) {
    log.warn(
      `Rejected register social precheck from ip='${clientIp}' because signup is disabled.`,
    );
    return NextResponse.json({ error: "signup_disabled" }, { status: 403 });
  }

  let payload: RegisterSocialPrecheckPayload;
  try {
    payload = (await request.json()) as RegisterSocialPrecheckPayload;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const provider = toSafeString(payload.provider).toLowerCase();
  const username = toSafeString(payload.username);
  const email = toSafeString(payload.email).toLowerCase();

  if (!isSupportedProvider(provider)) {
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
    log.info(
      `Denied register social precheck for provider='${provider}' username='${username}' email='${email || "unknown"}' from ip='${clientIp}' due to conflict='${registrationConflict}'.`,
    );
    return NextResponse.json(
      { canProceed: false, error: registrationConflict },
      { status: 200 },
    );
  }

  log.info(
    `Allowed register social precheck for provider='${provider}' username='${username}' email='${email || "unknown"}' from ip='${clientIp}'.`,
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
