import { NextResponse } from "next/server";
import { ensureAuthDatabaseReady, hasAnyAuthUser, setupAuth } from "@/lib/auth";
import {
  acquireAuthSetupBootstrapLock,
  getAuthSetupLockPath,
  isAuthSetupLocked,
  writeAuthSetupLock,
} from "@/lib/auth/setup-lock";
import { logger } from "@/lib/logger";
import { isPasswordPolicyValid } from "@/lib/password-policy";
import { isUsernamePolicyValid } from "@/lib/username-policy";

const log = logger.withScope("AuthSetup");

declare global {
  var _authSetupTokenWarningLogged: boolean | undefined;
}

global._authSetupTokenWarningLogged ??= false;

type SetupPayload = {
  token?: unknown;
  email?: unknown;
  password?: unknown;
  name?: unknown;
  username?: unknown;
};

type SetupErrorBody = {
  error?: unknown;
  code?: unknown;
};

function getClientIp(request: Request | undefined) {
  if (!request) return "unknown";
  const forwardedFor = request.headers.get("x-forwarded-for");
  const firstForwardedIp = forwardedFor?.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip")?.trim();
  return (firstForwardedIp || realIp || "unknown").slice(0, 128);
}

function isSetupEnabledByEnv() {
  const token = process.env.AUTH_SETUP_TOKEN;
  return typeof token === "string" && token.length >= 32;
}

function logMissingSetupTokenOnce() {
  if (global._authSetupTokenWarningLogged) {
    return;
  }
  log.error(
    "Setup endpoint disabled because AUTH_SETUP_TOKEN is missing or shorter than 32 characters.",
  );
  global._authSetupTokenWarningLogged = true;
}

function disabledResponse() {
  return new NextResponse("Not Found", { status: 404 });
}

function setupStateUnknownResponse() {
  return NextResponse.json({ error: "setup_state_unknown" }, { status: 503 });
}

function toSafeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isLikelyEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isValidUsername(value: string) {
  return isUsernamePolicyValid(value);
}

function normalizeErrorCode(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function extractErrorCodeFromPayload(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return normalizeErrorCode(value);
  if (typeof value !== "object") return "";
  const candidate = value as { code?: unknown; error?: unknown };
  return (
    normalizeErrorCode(candidate.code) ||
    normalizeErrorCode(candidate.error) ||
    ""
  );
}

async function getSetupSignUpErrorCode(response: Response) {
  try {
    const payload = (await response.clone().json()) as SetupErrorBody;
    return (
      extractErrorCodeFromPayload(payload.error) ||
      extractErrorCodeFromPayload(payload.code)
    );
  } catch {
    return "";
  }
}

function mapSignUpErrorToSetupError(errorCode: string) {
  if (!errorCode) {
    return "setup_failed";
  }

  if (
    errorCode === "user_already_exists" ||
    errorCode === "email_already_exists" ||
    errorCode === "email_already_in_use" ||
    errorCode === "email_in_use"
  ) {
    return "email_already_exists";
  }

  if (
    errorCode === "username_already_exists" ||
    errorCode === "username_already_in_use" ||
    errorCode === "username_in_use" ||
    errorCode === "username_taken"
  ) {
    return "username_already_exists";
  }

  if (errorCode === "invalid_username" || errorCode === "username_invalid") {
    return "invalid_username";
  }

  if (errorCode === "invalid_email" || errorCode === "email_invalid") {
    return "invalid_email";
  }

  if (
    errorCode === "invalid_password" ||
    errorCode === "weak_password" ||
    errorCode === "password_too_weak" ||
    errorCode === "password_policy_violation"
  ) {
    return "invalid_password_policy";
  }

  return "setup_failed";
}

async function backfillSetupLockForExistingUsers() {
  try {
    const result = await writeAuthSetupLock({
      reason: "user_exists",
      source: "/api/auth/setup",
    });
    if (result === "created") {
      log.info(
        `Detected existing auth users. Setup endpoint permanently disabled via lock file '${getAuthSetupLockPath()}'.`,
      );
    }
  } catch (error) {
    log.error(
      `Failed to persist setup lock file '${getAuthSetupLockPath()}' for existing users.`,
      error,
    );
  }
}

async function disableSetupAfterSuccessfulBootstrap(email: string) {
  try {
    const result = await writeAuthSetupLock({
      reason: "setup_completed",
      email,
      source: "/api/auth/setup",
    });
    if (result === "created") {
      log.info(
        `Initial setup lock file written to '${getAuthSetupLockPath()}'. Setup endpoint permanently disabled.`,
      );
    }
  } catch (error) {
    log.error(
      `Initial setup created user '${email}' but failed to write lock file '${getAuthSetupLockPath()}'.`,
      error,
    );
    throw error;
  }
}

export async function GET(request?: Request) {
  const clientIp = getClientIp(request);
  log.info(`Auth setup status check requested from ip='${clientIp}'.`);

  await ensureAuthDatabaseReady();
  if (!isSetupEnabledByEnv()) {
    logMissingSetupTokenOnce();
    log.warn(
      `Rejected setup status check from ip='${clientIp}' because AUTH_SETUP_TOKEN is not valid.`,
    );
    return disabledResponse();
  }
  if (await isAuthSetupLocked()) {
    log.info(
      `Rejected setup status check from ip='${clientIp}' because setup is locked.`,
    );
    return disabledResponse();
  }
  const authUserState = hasAnyAuthUser();
  if (authUserState === "unknown") {
    log.error(
      `Rejected setup status check from ip='${clientIp}' because auth user existence could not be determined.`,
    );
    return setupStateUnknownResponse();
  }
  if (authUserState === "has_user") {
    await backfillSetupLockForExistingUsers();
    log.info(
      `Rejected setup status check from ip='${clientIp}' because at least one auth user already exists.`,
    );
    return disabledResponse();
  }
  log.info(`Setup is available for ip='${clientIp}'.`);
  return NextResponse.json({ setupRequired: true }, { status: 200 });
}

export async function POST(request: Request) {
  const clientIp = getClientIp(request);
  log.info(`Initial setup attempt received from ip='${clientIp}'.`);

  await ensureAuthDatabaseReady();
  if (!isSetupEnabledByEnv()) {
    logMissingSetupTokenOnce();
    log.warn(
      `Rejected setup attempt from ip='${clientIp}' because AUTH_SETUP_TOKEN is not valid.`,
    );
    return disabledResponse();
  }
  if (await isAuthSetupLocked()) {
    log.warn(
      `Rejected setup attempt from ip='${clientIp}' because setup is locked.`,
    );
    return disabledResponse();
  }
  const authUserState = hasAnyAuthUser();
  if (authUserState === "unknown") {
    log.error(
      `Rejected setup attempt from ip='${clientIp}' because auth user existence could not be determined.`,
    );
    return setupStateUnknownResponse();
  }
  if (authUserState === "has_user") {
    await backfillSetupLockForExistingUsers();
    log.warn(
      `Rejected setup attempt from ip='${clientIp}' because at least one auth user already exists.`,
    );
    return disabledResponse();
  }

  let payload: SetupPayload;
  try {
    payload = (await request.json()) as SetupPayload;
  } catch {
    log.warn(
      `Rejected setup attempt from ip='${clientIp}' due to invalid JSON body.`,
    );
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const token = toSafeString(payload.token);
  const email = toSafeString(payload.email).toLowerCase();
  const password = toSafeString(payload.password);
  const name = toSafeString(payload.name);
  const username = toSafeString(payload.username);

  if (token !== process.env.AUTH_SETUP_TOKEN) {
    log.warn(
      `Rejected setup attempt from ip='${clientIp}' due to invalid setup token.`,
    );
    return NextResponse.json({ error: "invalid_setup_token" }, { status: 401 });
  }

  if (
    !isLikelyEmail(email) ||
    !isPasswordPolicyValid(password) ||
    !isValidUsername(username)
  ) {
    log.warn(
      `Rejected setup attempt from ip='${clientIp}' due to invalid input.`,
    );
    if (!isLikelyEmail(email)) {
      return NextResponse.json({ error: "invalid_email" }, { status: 400 });
    }
    if (!isValidUsername(username)) {
      return NextResponse.json({ error: "invalid_username" }, { status: 400 });
    }
    return NextResponse.json(
      { error: "invalid_password_policy" },
      { status: 400 },
    );
  }

  const signUpBody: {
    email: string;
    password: string;
    name: string;
    username: string;
  } = {
    email,
    password,
    name: name || "Administrator",
    username,
  };

  const bootstrapLock = await acquireAuthSetupBootstrapLock({
    source: "/api/auth/setup",
  });
  if (bootstrapLock.status === "busy") {
    log.warn(
      `Rejected setup attempt from ip='${clientIp}' because another setup bootstrap is already in progress.`,
    );
    return NextResponse.json({ error: "setup_in_progress" }, { status: 409 });
  }

  try {
    if (await isAuthSetupLocked()) {
      log.warn(
        `Rejected setup attempt from ip='${clientIp}' because setup became locked during bootstrap.`,
      );
      return disabledResponse();
    }
    const authUserStateAfterLock = hasAnyAuthUser();
    if (authUserStateAfterLock === "unknown") {
      log.error(
        `Rejected setup attempt from ip='${clientIp}' because auth user existence could not be determined after acquiring bootstrap lock.`,
      );
      return setupStateUnknownResponse();
    }
    if (authUserStateAfterLock === "has_user") {
      await backfillSetupLockForExistingUsers();
      log.warn(
        `Rejected setup attempt from ip='${clientIp}' because an auth user was created during bootstrap.`,
      );
      return disabledResponse();
    }

    const signUpResponse = await setupAuth.api.signUpEmail({
      headers: request.headers,
      body: signUpBody,
      asResponse: true,
    });

    if (!signUpResponse.ok) {
      const upstreamErrorCode = await getSetupSignUpErrorCode(signUpResponse);
      const mappedError = mapSignUpErrorToSetupError(upstreamErrorCode);
      log.warn(
        `Initial setup sign-up failed with status ${signUpResponse.status} from ip='${clientIp}'${upstreamErrorCode ? ` (error='${upstreamErrorCode}')` : ""}.`,
      );
      return NextResponse.json(
        { error: mappedError },
        { status: signUpResponse.status || 400 },
      );
    }

    try {
      await disableSetupAfterSuccessfulBootstrap(email);
    } catch {
      return NextResponse.json({ error: "setup_lock_failed" }, { status: 500 });
    }

    log.info(
      `Initial setup finished for '${email}' from ip='${clientIp}'. Setup endpoint is now permanently disabled.`,
    );
    return NextResponse.json({ ok: true }, { status: 201 });
  } finally {
    try {
      await bootstrapLock.release();
    } catch (error) {
      log.error("Failed to release setup bootstrap lock.", error);
    }
  }
}
