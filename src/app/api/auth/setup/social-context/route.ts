import { NextResponse } from "next/server";
import { ensureAuthDatabaseReady, hasAnyAuthUser } from "@/lib/auth";
import {
  getAuthSetupToken,
  isAuthSetupTokenConfigured,
  isSocialProviderConfigured,
} from "@/lib/auth/config";
import { getClientIpFromHeaders } from "@/lib/auth/request-context";
import { isAuthSetupLocked } from "@/lib/auth/setup-lock";
import {
  buildSetupSocialContextSetCookieHeader,
  buildSetupSocialContextValue,
} from "@/lib/auth/setup-social-context";
import { logger } from "@/lib/logger";
import { isUsernamePolicyValid } from "@/lib/username-policy";

const log = logger.withScope("AuthSetupSocial");

type SetupSocialPayload = {
  token?: unknown;
  provider?: unknown;
  username?: unknown;
  name?: unknown;
};

function toSafeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isValidUsername(value: string) {
  return isUsernamePolicyValid(value);
}

function isSupportedProvider(value: string): value is "github" | "google" {
  return value === "github" || value === "google";
}

function getClientIp(request: Request) {
  return getClientIpFromHeaders(request.headers);
}

function disabledResponse() {
  return new NextResponse("Not Found", { status: 404 });
}

function setupStateUnknownResponse() {
  return NextResponse.json({ error: "setup_state_unknown" }, { status: 503 });
}

export async function POST(request: Request) {
  const clientIp = getClientIp(request);
  log.info(`Initial social setup context requested from ip='${clientIp}'.`);

  await ensureAuthDatabaseReady();

  if (!isAuthSetupTokenConfigured()) {
    log.warn(
      `Rejected initial social setup context from ip='${clientIp}' because AUTH_SETUP_TOKEN is invalid.`,
    );
    return disabledResponse();
  }
  if (await isAuthSetupLocked()) {
    log.warn(
      `Rejected initial social setup context from ip='${clientIp}' because setup is locked.`,
    );
    return disabledResponse();
  }
  const authUserState = hasAnyAuthUser();
  if (authUserState === "unknown") {
    log.error(
      `Rejected initial social setup context from ip='${clientIp}' because auth user existence could not be determined.`,
    );
    return setupStateUnknownResponse();
  }
  if (authUserState === "has_user") {
    log.warn(
      `Rejected initial social setup context from ip='${clientIp}' because at least one auth user already exists.`,
    );
    return disabledResponse();
  }

  let payload: SetupSocialPayload;
  try {
    payload = (await request.json()) as SetupSocialPayload;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const token = toSafeString(payload.token);
  const provider = toSafeString(payload.provider).toLowerCase();
  const username = toSafeString(payload.username);
  const name = toSafeString(payload.name);

  if (token !== getAuthSetupToken()) {
    log.warn(
      `Rejected initial social setup context from ip='${clientIp}' due to invalid setup token.`,
    );
    return NextResponse.json({ error: "invalid_setup_token" }, { status: 401 });
  }

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

  const contextValue = buildSetupSocialContextValue({
    username,
    name,
  });
  const response = NextResponse.json({ ok: true }, { status: 200 });
  response.headers.append(
    "set-cookie",
    buildSetupSocialContextSetCookieHeader(contextValue),
  );
  log.info(
    `Initial social setup context accepted for provider='${provider}' username='${username}' from ip='${clientIp}'.`,
  );
  return response;
}
