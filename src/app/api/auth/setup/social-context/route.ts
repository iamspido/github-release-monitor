import { NextResponse } from "next/server";
import {
  getAuthSetupToken,
  isSocialProviderConfigured,
} from "@/lib/auth/config";
import {
  getClientIpFromRequest,
  isSupportedAuthSocialProvider,
  readJsonPayload,
  toSafeString,
} from "@/lib/auth/request-context";
import { secretsEqual } from "@/lib/auth/secret";
import { getAuthSetupAvailability } from "@/lib/auth/setup-route-guard";
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

function isValidUsername(value: string) {
  return isUsernamePolicyValid(value);
}

function disabledResponse() {
  return new NextResponse("Not Found", { status: 404 });
}

function setupStateUnknownResponse() {
  return NextResponse.json({ error: "setup_state_unknown" }, { status: 503 });
}

async function guardSocialSetupAvailability(
  clientIp: string,
): Promise<Response | null> {
  const availability = await getAuthSetupAvailability();
  if (availability === "available") return null;
  if (availability === "state_unknown") {
    log.error(
      `Rejected initial social setup context from ip='${clientIp}' because auth user existence could not be determined.`,
    );
    return setupStateUnknownResponse();
  }

  const reason =
    availability === "token_invalid"
      ? "AUTH_SETUP_TOKEN is invalid"
      : availability === "locked"
        ? "setup is locked"
        : "at least one auth user already exists";
  log.warn(
    `Rejected initial social setup context from ip='${clientIp}' because ${reason}.`,
  );
  return disabledResponse();
}

export async function POST(request: Request) {
  const clientIp = getClientIpFromRequest(request);
  log.info(`Initial social setup context requested from ip='${clientIp}'.`);

  const rejection = await guardSocialSetupAvailability(clientIp);
  if (rejection) return rejection;

  const jsonResult = await readJsonPayload<SetupSocialPayload>(request);
  if (!jsonResult.ok) {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const payload = jsonResult.payload;

  const token = toSafeString(payload.token);
  const provider = toSafeString(payload.provider).toLowerCase();
  const username = toSafeString(payload.username);
  const name = toSafeString(payload.name);

  if (!secretsEqual(token, getAuthSetupToken())) {
    log.warn(
      `Rejected initial social setup context from ip='${clientIp}' due to invalid setup token.`,
    );
    return NextResponse.json({ error: "invalid_setup_token" }, { status: 401 });
  }

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
