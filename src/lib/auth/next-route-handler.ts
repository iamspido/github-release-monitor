import { toNextJsHandler } from "better-auth/next-js";
import {
  applySocialRegistrationProfile,
  auth,
  canDeletePasskeyForUser,
  canUnlinkAccountForUser,
  ensureAuthDatabaseReady,
  ensureInitialAuthUserProfile,
  getAuthUserIdSnapshot,
  hasAnyAuthUser,
  hasValidAuthSessionForRequest,
  setupAuth,
} from "@/lib/auth";
import { scheduleLoginMethodRemoval } from "@/lib/auth/login-method-removal-queue";
import {
  getClientIpFromRequest,
  isSupportedAuthSocialProvider,
} from "@/lib/auth/request-context";
import {
  acquireAuthSetupBootstrapLock,
  isAuthSetupLocked,
  writeAuthSetupLock,
} from "@/lib/auth/setup-lock";
import {
  buildSetupSocialContextSetCookieHeader,
  readSetupSocialContextFromRequest,
} from "@/lib/auth/setup-social-context";
import {
  buildSocialLoginIntentSetCookieHeader,
  readSocialLoginIntentFromRequest,
} from "@/lib/auth/social-login-intent";
import {
  buildSecretRevealPendingSetCookieHeader,
  buildSecretRevealVerifiedSetCookieHeader,
  createSecretRevealStepUpPayload,
  readSecretRevealPendingFromRequest,
} from "@/lib/diagnostics/secret-reveal-step-up";
import { logger } from "@/lib/logger";

const handler = toNextJsHandler(auth);
const setupHandler = toNextJsHandler(setupAuth);
const log = logger.withScope("AuthApi");

type AuthRouteMethod = "GET" | "POST";
type AuthUserState = ReturnType<typeof hasAnyAuthUser>;
type SocialIntent = ReturnType<typeof readSocialLoginIntentFromRequest>;
type SetupSocialContext = ReturnType<typeof readSetupSocialContextFromRequest>;
type SetupBootstrapLock = Awaited<
  ReturnType<typeof acquireAuthSetupBootstrapLock>
>;

interface AuthRouteState {
  action: string;
  authUserState: AuthUserState;
  callbackProvider: string | null;
  clientIp: string;
  hasValidSession: boolean;
  oauthError: string | null;
  setupBootstrapLock: SetupBootstrapLock | null;
  setupFlowAllowed: boolean;
  setupSocialContext: SetupSocialContext;
  socialAction: boolean;
  socialIntent: SocialIntent;
  socialIntentGuardActive: boolean;
  socialRegistrationSnapshot: ReturnType<typeof getAuthUserIdSnapshot> | null;
}

function getAuthActionFromPathname(pathname: string) {
  const prefix = "/api/auth/";
  if (!pathname.startsWith(prefix)) {
    return pathname;
  }
  return pathname.slice(prefix.length) || "(root)";
}

function getOAuthProviderFromAction(action: string) {
  if (!action.startsWith("callback/")) {
    return null;
  }
  const provider = action.split("/")[1] || "";
  return provider || null;
}

function isSetupEnvEnabled() {
  const token = process.env.AUTH_SETUP_TOKEN;
  return typeof token === "string" && token.length >= 32;
}

function isSocialAuthAction(action: string) {
  return action === "sign-in/social" || action.startsWith("callback/");
}

function isSocialSignInAction(action: string) {
  return action === "sign-in/social";
}

async function getSocialProviderFromSignInRequest(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  const clonedRequest = request.clone();
  const bodyText = await clonedRequest.text();
  if (!bodyText) return null;

  if (contentType.includes("application/json")) {
    try {
      const data = JSON.parse(bodyText) as { provider?: unknown };
      const provider =
        typeof data.provider === "string"
          ? data.provider.trim().toLowerCase()
          : "";
      return provider || null;
    } catch {
      return null;
    }
  }

  if (contentType.includes("application/x-www-form-urlencoded")) {
    const params = new URLSearchParams(bodyText);
    const provider = params.get("provider")?.trim().toLowerCase();
    return provider || null;
  }

  return null;
}

type UnlinkAccountSelection = {
  providerId: string;
  accountId?: string;
};

async function getAccountSelectionFromUnlinkRequest(
  request: Request,
): Promise<UnlinkAccountSelection | null> {
  try {
    const data = (await request.clone().json()) as {
      providerId?: unknown;
      accountId?: unknown;
    };
    if (typeof data.providerId !== "string" || !data.providerId) return null;
    if (data.accountId !== undefined && typeof data.accountId !== "string") {
      return null;
    }
    return {
      providerId: data.providerId,
      ...(data.accountId !== undefined ? { accountId: data.accountId } : {}),
    };
  } catch {
    return null;
  }
}

async function getPasskeyIdFromDeleteRequest(request: Request) {
  try {
    const data = (await request.clone().json()) as { id?: unknown };
    return typeof data.id === "string" ? data.id.trim() : "";
  } catch {
    return "";
  }
}

function setupStateUnknownResponse(clearSetupContext = false) {
  const headers = new Headers({
    "content-type": "application/json",
  });
  if (clearSetupContext) {
    headers.append("set-cookie", buildSetupSocialContextSetCookieHeader(null));
  }
  return new Response(JSON.stringify({ error: "setup_state_unknown" }), {
    status: 503,
    headers,
  });
}

function withAppendedCookie(response: Response, cookie: string) {
  const nextResponse = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: new Headers(response.headers),
  });
  nextResponse.headers.append("set-cookie", cookie);
  return nextResponse;
}

function logResponse(
  method: AuthRouteMethod,
  action: string,
  status: number,
  durationMs: number,
) {
  const message = `Auth API response: ${method} /api/auth/${action} status=${status} duration_ms=${durationMs}`;
  if (status >= 500) {
    log.error(message);
    return;
  }
  if (status >= 400) {
    log.warn(message);
    return;
  }
  log.info(message);
}

async function guardSocialIntent(args: {
  method: AuthRouteMethod;
  action: string;
  request: Request;
  clientIp: string;
  socialIntent: ReturnType<typeof readSocialLoginIntentFromRequest>;
}) {
  const expectedProvider = await getSocialProviderFromSignInRequest(
    args.request,
  );

  if (!isSupportedAuthSocialProvider(expectedProvider)) {
    log.warn(
      `Blocked social auth ${args.method} /api/auth/${args.action} from ip='${args.clientIp}' due to missing/invalid provider.`,
    );
    return new Response(JSON.stringify({ error: "invalid_provider" }), {
      status: 400,
      headers: {
        "content-type": "application/json",
        "set-cookie": buildSocialLoginIntentSetCookieHeader(null),
      },
    });
  }

  const socialIntentValid = Boolean(
    args.socialIntent && args.socialIntent.provider === expectedProvider,
  );
  if (!socialIntentValid) {
    log.warn(
      `Blocked social auth ${args.method} /api/auth/${args.action} for provider='${expectedProvider}' from ip='${args.clientIp}' because no valid precheck intent was present.`,
    );
    return new Response(JSON.stringify({ error: "social_precheck_required" }), {
      status: 403,
      headers: {
        "content-type": "application/json",
        "set-cookie": buildSocialLoginIntentSetCookieHeader(null),
      },
    });
  }

  return null;
}

function clearCallbackCookies(args: {
  response: Response;
  setupCallback: boolean;
  socialCallback: boolean;
}) {
  let finalResponse = args.response;
  if (args.setupCallback) {
    finalResponse = withAppendedCookie(
      finalResponse,
      buildSetupSocialContextSetCookieHeader(null),
    );
  }
  if (args.socialCallback) {
    finalResponse = withAppendedCookie(
      finalResponse,
      buildSocialLoginIntentSetCookieHeader(null),
    );
  }
  return finalResponse;
}

function markSecretRevealSocialStepUpVerified(args: {
  response: Response;
  request: Request;
  action: string;
  callbackProvider: string | null;
  oauthError: string | null;
}) {
  const responseOAuthError = getOAuthErrorFromResponseLocation(args.response);
  if (
    !args.action.startsWith("callback/") ||
    args.response.status >= 400 ||
    args.oauthError ||
    responseOAuthError
  ) {
    return args.response;
  }

  const pendingStepUp = readSecretRevealPendingFromRequest(args.request);
  if (
    pendingStepUp?.method !== "social" ||
    !pendingStepUp.provider ||
    pendingStepUp.provider !== args.callbackProvider
  ) {
    return args.response;
  }

  let finalResponse = withAppendedCookie(
    args.response,
    buildSecretRevealPendingSetCookieHeader(null),
  );
  finalResponse = withAppendedCookie(
    finalResponse,
    buildSecretRevealVerifiedSetCookieHeader(
      createSecretRevealStepUpPayload({
        userId: pendingStepUp.userId,
        method: "social",
        provider: pendingStepUp.provider,
        target: pendingStepUp.target,
      }),
    ),
  );
  log.warn(
    `Secret reveal social step-up verified via provider callback '${args.action}'.`,
  );
  return finalResponse;
}

function getOAuthErrorFromResponseLocation(response: Response) {
  const location = response.headers.get("location");
  if (!location) return null;

  try {
    const parsed = new URL(location, "http://localhost");
    return parsed.searchParams.get("error") || parsed.searchParams.get("code");
  } catch {
    return null;
  }
}

async function createAuthRouteState(request: Request): Promise<AuthRouteState> {
  const url = new URL(request.url);
  const action = getAuthActionFromPathname(url.pathname);
  const setupSocialContext = readSetupSocialContextFromRequest(request);
  const socialAction = isSocialAuthAction(action);
  const socialIntent = socialAction
    ? readSocialLoginIntentFromRequest(request)
    : null;
  const authUserState = hasAnyAuthUser();
  const hasValidSession = hasValidAuthSessionForRequest(request);
  const setupLocked =
    socialAction && setupSocialContext ? await isAuthSetupLocked() : false;
  const setupFlowAllowed =
    socialAction &&
    Boolean(setupSocialContext) &&
    isSetupEnvEnabled() &&
    !setupLocked &&
    authUserState === "no_user";
  const callbackProvider = getOAuthProviderFromAction(action);
  const socialRegistrationSnapshot =
    action.startsWith("callback/") &&
    socialIntent?.purpose === "register" &&
    socialIntent.provider === callbackProvider &&
    !setupFlowAllowed
      ? getAuthUserIdSnapshot()
      : null;
  const setupCallbackNeedsBootstrapLock =
    setupFlowAllowed && action.startsWith("callback/");
  const setupBootstrapLock = setupCallbackNeedsBootstrapLock
    ? await acquireAuthSetupBootstrapLock({
        source: `/api/auth/${action}`,
      })
    : null;

  return {
    action,
    authUserState,
    callbackProvider,
    clientIp: getClientIpFromRequest(request),
    hasValidSession,
    oauthError: url.searchParams.get("error"),
    setupBootstrapLock,
    setupFlowAllowed,
    setupSocialContext,
    socialAction,
    socialIntent,
    socialIntentGuardActive:
      isSocialSignInAction(action) && !setupFlowAllowed && !hasValidSession,
    socialRegistrationSnapshot,
  };
}

async function guardSetupSocialState(state: AuthRouteState) {
  if (
    state.socialAction &&
    state.setupSocialContext &&
    state.authUserState === "unknown"
  ) {
    log.error(
      `Blocked setup social flow '${state.action}' from ip='${state.clientIp}' because auth user existence could not be determined.`,
    );
    return setupStateUnknownResponse(true);
  }

  if (state.setupBootstrapLock?.status === "busy") {
    log.warn(
      `Blocked setup social callback '${state.action}' from ip='${state.clientIp}' because another setup bootstrap is already in progress.`,
    );
    return new Response(JSON.stringify({ error: "setup_in_progress" }), {
      status: 409,
      headers: {
        "content-type": "application/json",
        "set-cookie": buildSetupSocialContextSetCookieHeader(null),
      },
    });
  }

  if (state.setupBootstrapLock?.status !== "acquired") {
    return null;
  }

  if (await isAuthSetupLocked()) {
    await state.setupBootstrapLock.release();
    log.warn(
      `Blocked setup social callback '${state.action}' from ip='${state.clientIp}' because setup became locked during bootstrap.`,
    );
    return new Response("Not Found", { status: 404 });
  }

  const authUserStateAfterLock = hasAnyAuthUser();
  if (authUserStateAfterLock === "unknown") {
    await state.setupBootstrapLock.release();
    log.error(
      `Blocked setup social callback '${state.action}' from ip='${state.clientIp}' because auth user existence could not be determined after acquiring bootstrap lock.`,
    );
    return setupStateUnknownResponse(true);
  }

  if (authUserStateAfterLock === "has_user") {
    await state.setupBootstrapLock.release();
    log.warn(
      `Blocked setup social callback '${state.action}' from ip='${state.clientIp}' because an auth user was created during bootstrap.`,
    );
    return new Response("Not Found", { status: 404 });
  }

  return null;
}

function logAuthRouteStart(method: AuthRouteMethod, state: AuthRouteState) {
  log.info(
    `Auth API request: ${method} /api/auth/${state.action} ip='${state.clientIp}'`,
  );
  if (state.setupFlowAllowed) {
    log.info(
      `Auth setup social flow is active for ${method} /api/auth/${state.action} from ip='${state.clientIp}'.`,
    );
  } else if (
    state.action.startsWith("callback/") &&
    state.authUserState === "no_user" &&
    isSetupEnvEnabled() &&
    !state.setupSocialContext
  ) {
    log.warn(
      `OAuth callback '${state.action}' reached auth API without setup context cookie while no users exist. Falling back to normal auth handler.`,
    );
  } else if (
    state.socialAction &&
    state.hasValidSession &&
    !state.setupFlowAllowed
  ) {
    log.debug(
      `Skipping social precheck intent guard for authenticated ${method} /api/auth/${state.action} from ip='${state.clientIp}'.`,
    );
  }

  if (state.oauthError) {
    const provider = state.callbackProvider || "unknown";
    log.warn(
      `OAuth callback returned error='${state.oauthError}' for provider='${provider}' ip='${state.clientIp}'.`,
    );
  }
}

async function runAuthHandler(
  method: AuthRouteMethod,
  request: Request,
  allowUserCreation: boolean,
) {
  const activeHandler = allowUserCreation ? setupHandler : handler;
  return method === "GET"
    ? activeHandler.GET(request)
    : activeHandler.POST(request);
}

async function runGuardedAuthHandler(
  method: AuthRouteMethod,
  request: Request,
  state: AuthRouteState,
) {
  if (method !== "POST") {
    return runAuthHandler(method, request, state.setupFlowAllowed);
  }

  if (state.action === "unlink-account") {
    const account = await getAccountSelectionFromUnlinkRequest(request);
    const session = await auth.api.getSession({ headers: request.headers });
    const userId =
      typeof session?.user?.id === "string" ? session.user.id.trim() : "";

    if (!account || !userId) {
      log.warn(
        `Rejected direct account unlink from ip='${state.clientIp}' because the account or session is invalid.`,
      );
      return new Response(
        JSON.stringify({ error: "social_accounts_unlink_error" }),
        {
          status: 400,
          headers: { "content-type": "application/json" },
        },
      );
    }

    return scheduleLoginMethodRemoval(userId, async () => {
      if (
        !canUnlinkAccountForUser(userId, account.providerId, account.accountId)
      ) {
        log.warn(
          `Rejected direct account unlink from ip='${state.clientIp}' because it would remove the last login method or the account is invalid.`,
        );
        return new Response(
          JSON.stringify({ error: "social_accounts_unlink_error" }),
          {
            status: 400,
            headers: { "content-type": "application/json" },
          },
        );
      }

      return runAuthHandler(method, request, false);
    });
  }

  if (state.action === "passkey/delete-passkey") {
    const passkeyId = await getPasskeyIdFromDeleteRequest(request);
    const session = await auth.api.getSession({ headers: request.headers });
    const userId =
      typeof session?.user?.id === "string" ? session.user.id.trim() : "";

    if (!passkeyId || !userId) {
      log.warn(
        `Rejected direct passkey deletion from ip='${state.clientIp}' because the passkey or session is invalid.`,
      );
      return new Response(JSON.stringify({ error: "passkeys_error_delete" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    return scheduleLoginMethodRemoval(userId, async () => {
      if (!canDeletePasskeyForUser(userId, passkeyId)) {
        log.warn(
          `Rejected direct passkey deletion from ip='${state.clientIp}' because it would remove the last login method or the passkey is invalid.`,
        );
        return new Response(
          JSON.stringify({ error: "passkeys_error_delete" }),
          {
            status: 400,
            headers: { "content-type": "application/json" },
          },
        );
      }

      return runAuthHandler(method, request, false);
    });
  }

  return runAuthHandler(method, request, state.setupFlowAllowed);
}

function applySocialRegistrationProfileForCallback(state: AuthRouteState) {
  if (
    !state.socialRegistrationSnapshot ||
    state.socialIntent?.purpose !== "register"
  ) {
    return;
  }

  const profileResult = applySocialRegistrationProfile({
    previousUserIds: state.socialRegistrationSnapshot,
    username: state.socialIntent.username || "",
    email: state.socialIntent.email,
  });
  if (profileResult === "applied") {
    log.info(
      `Applied social registration username for provider callback '${state.action}'.`,
    );
  } else if (profileResult !== "no_new_user") {
    log.warn(
      `Could not apply social registration username for provider callback '${state.action}' (result='${profileResult}').`,
    );
  }
}

async function finalizeSocialSetupCallback(state: AuthRouteState) {
  if (!state.setupFlowAllowed || !state.action.startsWith("callback/")) {
    return null;
  }

  const authUserStateAfterCallback = hasAnyAuthUser();
  if (authUserStateAfterCallback === "no_user") {
    log.warn(
      `Social setup callback '${state.action}' completed without creating a user. Setup remains enabled.`,
    );
    return null;
  }
  if (authUserStateAfterCallback === "unknown") {
    log.error(
      `Social setup callback '${state.action}' completed but auth user existence could not be determined. Setup lock was not written.`,
    );
    return setupStateUnknownResponse(true);
  }

  const profileResult = ensureInitialAuthUserProfile({
    username: state.setupSocialContext?.username || "",
    name: state.setupSocialContext?.name,
  });
  const lockResult = await writeAuthSetupLock({
    reason: "setup_completed",
    email: profileResult?.email || undefined,
    source: `/api/auth/${state.action}`,
  });
  if (lockResult === "created") {
    log.info(
      `Initial social setup completed for provider callback '${state.action}'. Setup endpoint permanently disabled.`,
    );
  }
  return null;
}

async function postProcessAuthResponse(args: {
  request: Request;
  response: Response;
  state: AuthRouteState;
}) {
  const { request, response, state } = args;
  let finalResponse = clearCallbackCookies({
    response,
    setupCallback: Boolean(
      state.setupSocialContext && state.action.startsWith("callback/"),
    ),
    socialCallback: state.socialAction && state.action.startsWith("callback/"),
  });
  finalResponse = markSecretRevealSocialStepUpVerified({
    response: finalResponse,
    request,
    action: state.action,
    callbackProvider: state.callbackProvider,
    oauthError: state.oauthError,
  });

  if (finalResponse.status < 400) {
    applySocialRegistrationProfileForCallback(state);
  }

  return (await finalizeSocialSetupCallback(state)) ?? finalResponse;
}

export async function handleAuthRouteRequest(
  method: AuthRouteMethod,
  request: Request,
) {
  await ensureAuthDatabaseReady();
  const start = Date.now();
  const state = await createAuthRouteState(request);
  const setupGuardResponse = await guardSetupSocialState(state);
  if (setupGuardResponse) return setupGuardResponse;

  logAuthRouteStart(method, state);

  if (state.socialIntentGuardActive) {
    const guardResponse = await guardSocialIntent({
      method,
      action: state.action,
      request,
      clientIp: state.clientIp,
      socialIntent: state.socialIntent,
    });
    if (guardResponse) return guardResponse;
  }

  try {
    const response =
      state.socialAction && state.socialIntent?.purpose === "register"
        ? await runAuthHandler(method, request, true)
        : await runGuardedAuthHandler(method, request, state);
    const finalResponse = await postProcessAuthResponse({
      response,
      request,
      state,
    });

    logResponse(method, state.action, finalResponse.status, Date.now() - start);
    return finalResponse;
  } catch (error) {
    log.error(
      `Unhandled error in Auth API route ${method} /api/auth/${state.action}.`,
      error,
    );
    throw error;
  } finally {
    if (state.setupBootstrapLock?.status === "acquired") {
      try {
        await state.setupBootstrapLock.release();
      } catch (error) {
        log.error("Failed to release setup bootstrap lock.", error);
      }
    }
  }
}
