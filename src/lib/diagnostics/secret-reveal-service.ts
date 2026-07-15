import { headers } from "next/headers";
import { getCurrentAuthAccess } from "@/lib/auth/access";
import { getClientIpFromHeaders } from "@/lib/auth/request-context";
import {
  createSecretRevealStepUpPayload,
  readSecretRevealStepUpCookie,
  SECRET_REVEAL_PENDING_COOKIE,
  SECRET_REVEAL_VERIFIED_COOKIE,
  type SecretRevealSocialProvider,
  type SecretRevealStepUpMethod,
  type SecretRevealTarget,
  setSecretRevealStepUpCookie,
} from "@/lib/diagnostics/secret-reveal-step-up";
import { logger } from "@/lib/logger";

const log = logger.withScope("Diagnostics");

const consumedStepUpNonces = new Map<string, number>();

function consumeStepUpNonce(nonce: string, expiresAt: number) {
  const now = Date.now();
  for (const [candidate, candidateExpiresAt] of consumedStepUpNonces) {
    if (candidateExpiresAt <= now) consumedStepUpNonces.delete(candidate);
  }
  if (consumedStepUpNonces.has(nonce)) return false;
  consumedStepUpNonces.set(nonce, expiresAt);
  return true;
}

type SecretRevealMethodAvailability = {
  password: boolean;
  totp: boolean;
  passkey: boolean;
  socialProviders: SecretRevealSocialProvider[];
};

type RevealDiagnosticSecretErrorKey =
  | "error_auth_required"
  | "error_mail_password_not_set"
  | "error_apprise_url_not_set"
  | "error_current_password_required"
  | "error_current_password_invalid"
  | "error_step_up_required"
  | "error_step_up_unavailable"
  | "error_step_up_failed"
  | "error_totp_required"
  | "error_totp_invalid"
  | "error_reveal_failed";

export type RevealMailPasswordResult =
  | { success: true; value: string }
  | {
      success: false;
      errorKey: RevealDiagnosticSecretErrorKey;
    };

export type RevealAppriseUrlResult = RevealMailPasswordResult;

export type SecretRevealOptionsResult =
  | {
      success: true;
      methods: SecretRevealMethodAvailability;
    }
  | { success: false; errorKey: RevealDiagnosticSecretErrorKey };

export type SecretRevealStepUpResult =
  | { success: true }
  | { success: false; errorKey: RevealDiagnosticSecretErrorKey };

type DiagnosticSecretPolicy = {
  envKey: "MAIL_PASSWORD" | "APPRISE_URL";
  notSetErrorKey: Extract<
    RevealDiagnosticSecretErrorKey,
    "error_mail_password_not_set" | "error_apprise_url_not_set"
  >;
  notSetLabel: string;
};

async function verifyDiagnosticRevealAccess(
  input: { currentPassword?: string } | undefined,
  envKey: "MAIL_PASSWORD" | "APPRISE_URL",
): Promise<
  | { success: true; clientIp: string; userId: string | null }
  | { success: false; errorKey: RevealDiagnosticSecretErrorKey }
> {
  const headerStore = await headers();
  const clientIp = getClientIpFromHeaders(headerStore);
  const access = await getCurrentAuthAccess();

  if (!access.canAccessRestrictedPages) {
    log.warn(
      `Rejected ${envKey} reveal from ip='${clientIp}' because the request is not authorized.`,
    );
    return { success: false, errorKey: "error_auth_required" };
  }

  if (access.authenticationMethod === "External") {
    return { success: true, clientIp, userId: null };
  }

  const { auth, ensureAuthDatabaseReady } = await import("@/lib/auth");
  await ensureAuthDatabaseReady();
  const session = await auth.api.getSession({
    headers: headerStore,
  });
  const userId =
    typeof session?.user?.id === "string" ? session.user.id : "unknown";

  if (userId !== "unknown" && !input?.currentPassword) {
    const verifiedStepUp = await readSecretRevealStepUpCookie(
      SECRET_REVEAL_VERIFIED_COOKIE,
    );
    const expectedTarget: SecretRevealTarget =
      envKey === "MAIL_PASSWORD" ? "mail_password" : "apprise_url";
    if (
      verifiedStepUp?.userId === userId &&
      verifiedStepUp.target === expectedTarget &&
      consumeStepUpNonce(verifiedStepUp.nonce, verifiedStepUp.expiresAt)
    ) {
      await setSecretRevealStepUpCookie(SECRET_REVEAL_VERIFIED_COOKIE, null);
      return { success: true, clientIp, userId };
    }
  }

  const currentPassword =
    typeof input?.currentPassword === "string" ? input.currentPassword : "";
  if (!currentPassword) {
    log.warn(
      `Rejected ${envKey} reveal from ip='${clientIp}' because step-up authentication is missing.`,
    );
    return { success: false, errorKey: "error_step_up_required" };
  }

  try {
    const email =
      typeof session?.user?.email === "string"
        ? session.user.email.trim().toLowerCase()
        : "";
    if (!email) {
      log.warn(
        `Rejected ${envKey} reveal from ip='${clientIp}' because no authenticated email was available.`,
      );
      return { success: false, errorKey: "error_auth_required" };
    }

    const signInResponse = await auth.api.signInEmail({
      headers: headerStore,
      body: { email, password: currentPassword },
      asResponse: true,
    });

    if (!signInResponse.ok) {
      log.warn(
        `Rejected ${envKey} reveal for user='${userId}' from ip='${clientIp}' due to invalid current password.`,
      );
      return { success: false, errorKey: "error_current_password_invalid" };
    }

    return { success: true, clientIp, userId };
  } catch (error) {
    log.error(`Failed ${envKey} reveal from ip='${clientIp}'.`, error);
    return { success: false, errorKey: "error_reveal_failed" };
  }
}

async function getAuthenticatedRevealUser(headerStore: Headers) {
  const { auth, ensureAuthDatabaseReady } = await import("@/lib/auth");
  await ensureAuthDatabaseReady();
  const session = await auth.api.getSession({
    headers: headerStore,
  });
  const userId =
    typeof session?.user?.id === "string" ? session.user.id.trim() : "";
  const email =
    typeof session?.user?.email === "string"
      ? session.user.email.trim().toLowerCase()
      : "";
  return userId ? { userId, email } : null;
}

async function getInternalRevealContext() {
  const headerStore = await headers();
  const clientIp = getClientIpFromHeaders(headerStore);
  const access = await getCurrentAuthAccess();
  if (!access.canAccessRestrictedPages) {
    return {
      success: false as const,
      clientIp,
      errorKey: "error_auth_required" as const,
    };
  }
  if (access.authenticationMethod === "External") {
    return {
      success: false as const,
      clientIp,
      errorKey: "error_step_up_unavailable" as const,
    };
  }
  const user = await getAuthenticatedRevealUser(headerStore);
  if (!user) {
    return {
      success: false as const,
      clientIp,
      errorKey: "error_auth_required" as const,
    };
  }
  return { success: true as const, headerStore, clientIp, user };
}

async function getStepUpMethodsForUser(userId: string) {
  const {
    getLinkedSocialProvidersForUser,
    hasCredentialPasswordAccount,
    hasVerifiedTotpForUser,
  } = await import("@/lib/auth");

  return {
    password: hasCredentialPasswordAccount(userId),
    totp: hasVerifiedTotpForUser(userId),
    // Client-side passkey sign-in is not enough for secret reveal. Keep this
    // disabled until a fresh passkey assertion can be verified server-side.
    passkey: false,
    socialProviders: getLinkedSocialProvidersForUser(userId),
  };
}

function isStepUpMethodAvailable(
  methods: SecretRevealMethodAvailability,
  method: SecretRevealStepUpMethod,
  provider?: SecretRevealSocialProvider,
) {
  if (method === "password") return methods.password;
  if (method === "totp") return methods.totp;
  if (method === "passkey") return methods.passkey;
  if (method === "social") {
    return provider ? methods.socialProviders.includes(provider) : false;
  }
  return false;
}

export async function getSecretRevealOptionsActionImpl(): Promise<SecretRevealOptionsResult> {
  const context = await getInternalRevealContext();
  if (!context.success) {
    return { success: false, errorKey: context.errorKey };
  }
  const methods = await getStepUpMethodsForUser(context.user.userId);
  return { success: true, methods };
}

export async function beginSecretRevealStepUpActionImpl(input: {
  method: SecretRevealStepUpMethod;
  provider?: SecretRevealSocialProvider;
  target?: SecretRevealTarget;
}): Promise<SecretRevealStepUpResult> {
  const context = await getInternalRevealContext();
  if (!context.success) {
    return { success: false, errorKey: context.errorKey };
  }
  const methods = await getStepUpMethodsForUser(context.user.userId);
  if (!isStepUpMethodAvailable(methods, input.method, input.provider)) {
    log.warn(
      `Rejected secret reveal step-up begin for user='${context.user.userId}' from ip='${context.clientIp}' because method='${input.method}' is unavailable.`,
    );
    return { success: false, errorKey: "error_step_up_unavailable" };
  }

  await setSecretRevealStepUpCookie(
    SECRET_REVEAL_PENDING_COOKIE,
    createSecretRevealStepUpPayload({
      userId: context.user.userId,
      method: input.method,
      provider: input.provider,
      target: input.target,
    }),
  );
  if (input.method === "social" && input.provider) {
    const { buildSocialLoginIntentValue, setSocialLoginIntentCookie } =
      await import("@/lib/auth/social-login-intent");
    await setSocialLoginIntentCookie(
      buildSocialLoginIntentValue(input.provider),
    );
  }
  return { success: true };
}

export async function completeSecretRevealStepUpActionImpl(input?: {
  target?: SecretRevealTarget;
}): Promise<SecretRevealStepUpResult> {
  const context = await getInternalRevealContext();
  if (!context.success) {
    return { success: false, errorKey: context.errorKey };
  }

  const verifiedStepUp = await readSecretRevealStepUpCookie(
    SECRET_REVEAL_VERIFIED_COOKIE,
  );
  if (
    !verifiedStepUp ||
    verifiedStepUp.userId !== context.user.userId ||
    verifiedStepUp.target !== (input?.target ?? "mail_password")
  ) {
    log.warn(
      `Rejected secret reveal step-up completion for user='${context.user.userId}' from ip='${context.clientIp}' because verified proof is missing or mismatched.`,
    );
    return { success: false, errorKey: "error_step_up_failed" };
  }

  log.warn(
    `Secret reveal step-up completed for user='${context.user.userId}' from ip='${context.clientIp}' via method='${verifiedStepUp.method}'.`,
  );
  return { success: true };
}

export async function verifySecretRevealTotpActionImpl(input: {
  code?: string;
  target?: SecretRevealTarget;
}): Promise<SecretRevealStepUpResult> {
  const context = await getInternalRevealContext();
  if (!context.success) {
    return { success: false, errorKey: context.errorKey };
  }

  const methods = await getStepUpMethodsForUser(context.user.userId);
  if (!methods.totp) {
    return { success: false, errorKey: "error_step_up_unavailable" };
  }

  const code = typeof input.code === "string" ? input.code.trim() : "";
  if (!code) {
    return { success: false, errorKey: "error_totp_required" };
  }

  try {
    const { auth } = await import("@/lib/auth");
    const response = await auth.api.verifyTOTP({
      headers: context.headerStore,
      body: { code, trustDevice: false },
      asResponse: true,
    });
    if (!response.ok) {
      return { success: false, errorKey: "error_totp_invalid" };
    }
  } catch (error) {
    log.error(
      `Failed TOTP step-up for user='${context.user.userId}' from ip='${context.clientIp}'.`,
      error,
    );
    return { success: false, errorKey: "error_totp_invalid" };
  }

  await setSecretRevealStepUpCookie(
    SECRET_REVEAL_VERIFIED_COOKIE,
    createSecretRevealStepUpPayload({
      userId: context.user.userId,
      method: "totp",
      target: input.target,
    }),
  );
  log.warn(
    `Secret reveal step-up completed for user='${context.user.userId}' from ip='${context.clientIp}' via method='totp'.`,
  );
  return { success: true };
}

export async function revealMailPasswordActionImpl(input?: {
  currentPassword?: string;
}): Promise<RevealMailPasswordResult> {
  return revealDiagnosticSecret(input, {
    envKey: "MAIL_PASSWORD",
    notSetErrorKey: "error_mail_password_not_set",
    notSetLabel: "password",
  });
}

export async function revealAppriseUrlActionImpl(input?: {
  currentPassword?: string;
}): Promise<RevealAppriseUrlResult> {
  return revealDiagnosticSecret(input, {
    envKey: "APPRISE_URL",
    notSetErrorKey: "error_apprise_url_not_set",
    notSetLabel: "URL",
  });
}

async function revealDiagnosticSecret(
  input: { currentPassword?: string } | undefined,
  policy: DiagnosticSecretPolicy,
): Promise<RevealMailPasswordResult> {
  const access = await verifyDiagnosticRevealAccess(input, policy.envKey);
  if (!access.success) {
    return { success: false, errorKey: access.errorKey };
  }

  const value = process.env[policy.envKey];
  if (!value) {
    log.info(
      `${policy.envKey} reveal requested from ip='${access.clientIp}' but no ${policy.notSetLabel} is configured.`,
    );
    return { success: false, errorKey: policy.notSetErrorKey };
  }

  log.warn(
    access.userId
      ? `${policy.envKey} revealed after password confirmation for user='${access.userId}' from ip='${access.clientIp}'.`
      : `${policy.envKey} revealed via external auth from ip='${access.clientIp}'.`,
  );
  return { success: true, value };
}
