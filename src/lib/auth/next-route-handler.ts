import { toNextJsHandler } from "better-auth/next-js";
import {
  applySocialRegistrationProfile,
  auth,
  ensureAuthDatabaseReady,
  ensureInitialAuthUserProfile,
  getAuthUserIdSnapshot,
  hasAnyAuthUser,
  hasValidAuthSessionForRequest,
  setupAuth,
} from "@/lib/auth";
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

export async function handleAuthRouteRequest(
  method: AuthRouteMethod,
  request: Request,
) {
  await ensureAuthDatabaseReady();
  const start = Date.now();
  const url = new URL(request.url);
  const action = getAuthActionFromPathname(url.pathname);
  const clientIp = getClientIpFromRequest(request);
  const setupSocialContext = readSetupSocialContextFromRequest(request);
  const socialAction = isSocialAuthAction(action);
  const socialIntent = socialAction
    ? readSocialLoginIntentFromRequest(request)
    : null;
  const authUserState = hasAnyAuthUser();
  const authUserStateUnknown = authUserState === "unknown";
  const hasValidSession = hasValidAuthSessionForRequest(request);
  const setupLocked =
    socialAction && setupSocialContext ? await isAuthSetupLocked() : false;
  const setupFlowAllowed =
    socialAction &&
    Boolean(setupSocialContext) &&
    isSetupEnvEnabled() &&
    !setupLocked &&
    authUserState === "no_user";
  const socialIntentGuardActive =
    isSocialSignInAction(action) && !setupFlowAllowed && !hasValidSession;
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

  if (socialAction && setupSocialContext && authUserStateUnknown) {
    log.error(
      `Blocked setup social flow '${action}' from ip='${clientIp}' because auth user existence could not be determined.`,
    );
    return setupStateUnknownResponse(true);
  }

  if (setupBootstrapLock?.status === "busy") {
    log.warn(
      `Blocked setup social callback '${action}' from ip='${clientIp}' because another setup bootstrap is already in progress.`,
    );
    return new Response(JSON.stringify({ error: "setup_in_progress" }), {
      status: 409,
      headers: {
        "content-type": "application/json",
        "set-cookie": buildSetupSocialContextSetCookieHeader(null),
      },
    });
  }

  if (setupBootstrapLock?.status === "acquired") {
    if (await isAuthSetupLocked()) {
      await setupBootstrapLock.release();
      log.warn(
        `Blocked setup social callback '${action}' from ip='${clientIp}' because setup became locked during bootstrap.`,
      );
      return new Response("Not Found", { status: 404 });
    }
    const authUserStateAfterLock = hasAnyAuthUser();
    if (authUserStateAfterLock === "unknown") {
      await setupBootstrapLock.release();
      log.error(
        `Blocked setup social callback '${action}' from ip='${clientIp}' because auth user existence could not be determined after acquiring bootstrap lock.`,
      );
      return setupStateUnknownResponse(true);
    }
    if (authUserStateAfterLock === "has_user") {
      await setupBootstrapLock.release();
      log.warn(
        `Blocked setup social callback '${action}' from ip='${clientIp}' because an auth user was created during bootstrap.`,
      );
      return new Response("Not Found", { status: 404 });
    }
  }

  const activeHandler = setupFlowAllowed ? setupHandler : handler;

  log.info(`Auth API request: ${method} /api/auth/${action} ip='${clientIp}'`);
  if (setupFlowAllowed) {
    log.info(
      `Auth setup social flow is active for ${method} /api/auth/${action} from ip='${clientIp}'.`,
    );
  } else if (
    action.startsWith("callback/") &&
    authUserState === "no_user" &&
    isSetupEnvEnabled() &&
    !setupSocialContext
  ) {
    log.warn(
      `OAuth callback '${action}' reached auth API without setup context cookie while no users exist. Falling back to normal auth handler.`,
    );
  } else if (socialAction && hasValidSession && !setupFlowAllowed) {
    log.debug(
      `Skipping social precheck intent guard for authenticated ${method} /api/auth/${action} from ip='${clientIp}'.`,
    );
  }

  const oauthError = url.searchParams.get("error");
  if (oauthError) {
    const provider = getOAuthProviderFromAction(action) || "unknown";
    log.warn(
      `OAuth callback returned error='${oauthError}' for provider='${provider}' ip='${clientIp}'.`,
    );
  }

  if (socialIntentGuardActive) {
    const guardResponse = await guardSocialIntent({
      method,
      action,
      request,
      clientIp,
      socialIntent,
    });
    if (guardResponse) return guardResponse;
  }

  try {
    const response =
      method === "GET"
        ? await activeHandler.GET(request)
        : await activeHandler.POST(request);
    let finalResponse = clearCallbackCookies({
      response,
      setupCallback: Boolean(
        setupSocialContext && action.startsWith("callback/"),
      ),
      socialCallback: socialAction && action.startsWith("callback/"),
    });
    finalResponse = markSecretRevealSocialStepUpVerified({
      response: finalResponse,
      request,
      action,
      callbackProvider,
      oauthError,
    });

    if (
      socialRegistrationSnapshot &&
      socialIntent?.purpose === "register" &&
      finalResponse.status < 400
    ) {
      const profileResult = applySocialRegistrationProfile({
        previousUserIds: socialRegistrationSnapshot,
        username: socialIntent.username || "",
        email: socialIntent.email,
      });
      if (profileResult === "applied") {
        log.info(
          `Applied social registration username for provider callback '${action}'.`,
        );
      } else if (profileResult !== "no_new_user") {
        log.warn(
          `Could not apply social registration username for provider callback '${action}' (result='${profileResult}').`,
        );
      }
    }

    if (setupFlowAllowed && action.startsWith("callback/")) {
      const authUserStateAfterCallback = hasAnyAuthUser();
      if (authUserStateAfterCallback === "no_user") {
        log.warn(
          `Social setup callback '${action}' completed without creating a user. Setup remains enabled.`,
        );
      } else if (authUserStateAfterCallback === "unknown") {
        log.error(
          `Social setup callback '${action}' completed but auth user existence could not be determined. Setup lock was not written.`,
        );
        return setupStateUnknownResponse(true);
      } else {
        const profileResult = ensureInitialAuthUserProfile({
          username: setupSocialContext?.username || "",
          name: setupSocialContext?.name,
        });
        const lockResult = await writeAuthSetupLock({
          reason: "setup_completed",
          email: profileResult?.email || undefined,
          source: `/api/auth/${action}`,
        });
        if (lockResult === "created") {
          log.info(
            `Initial social setup completed for provider callback '${action}'. Setup endpoint permanently disabled.`,
          );
        }
      }
    }

    logResponse(method, action, finalResponse.status, Date.now() - start);
    return finalResponse;
  } catch (error) {
    log.error(
      `Unhandled error in Auth API route ${method} /api/auth/${action}.`,
      error,
    );
    throw error;
  } finally {
    if (setupBootstrapLock?.status === "acquired") {
      try {
        await setupBootstrapLock.release();
      } catch (error) {
        log.error("Failed to release setup bootstrap lock.", error);
      }
    }
  }
}
