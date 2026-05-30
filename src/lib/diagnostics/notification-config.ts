import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { headers } from "next/headers";
import { getCurrentAuthAccess } from "@/lib/auth/access";
import { getAuthenticationMethod } from "@/lib/auth/mode";
import { logger } from "@/lib/logger";
import type { NotificationConfig } from "@/types";

const MASKED_VALUE = "••••••••";
const HIDDEN_SEGMENT = "<hidden>";
const STEP_UP_PENDING_COOKIE = "diagnostic_secret_reveal_pending";
const STEP_UP_VERIFIED_COOKIE = "diagnostic_secret_reveal_verified";
const STEP_UP_TTL_SECONDS = 5 * 60;
const log = logger.withScope("Diagnostics");

type SecretRevealStepUpMethod = "password" | "totp" | "passkey" | "social";
type SecretRevealSocialProvider = "github" | "google";
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

type StepUpCookiePayload = {
  userId: string;
  method: SecretRevealStepUpMethod;
  provider?: SecretRevealSocialProvider;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
};

function hasValue(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

function getStepUpSecret() {
  return process.env.BETTER_AUTH_SECRET || process.env.AUTH_SECRET || "";
}

function toBase64Url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function fromBase64Url(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signStepUpPayload(payloadPart: string) {
  const secret = getStepUpSecret();
  if (secret.length < 32) return "";
  return createHmac("sha256", secret).update(payloadPart).digest("base64url");
}

function encodeStepUpCookie(payload: StepUpCookiePayload) {
  const payloadPart = toBase64Url(JSON.stringify(payload));
  const signature = signStepUpPayload(payloadPart);
  return signature ? `${payloadPart}.${signature}` : "";
}

function decodeStepUpCookie(value: string | undefined) {
  if (!value) return null;
  const [payloadPart, signaturePart] = value.split(".");
  if (!payloadPart || !signaturePart) return null;

  const expectedSignature = signStepUpPayload(payloadPart);
  if (!expectedSignature) return null;
  try {
    const valid = timingSafeEqual(
      Buffer.from(signaturePart, "utf8"),
      Buffer.from(expectedSignature, "utf8"),
    );
    if (!valid) return null;
  } catch {
    return null;
  }

  try {
    const parsed = JSON.parse(
      fromBase64Url(payloadPart),
    ) as Partial<StepUpCookiePayload>;
    if (
      typeof parsed.userId !== "string" ||
      !parsed.userId ||
      (parsed.method !== "password" &&
        parsed.method !== "totp" &&
        parsed.method !== "passkey" &&
        parsed.method !== "social") ||
      typeof parsed.issuedAt !== "number" ||
      !Number.isFinite(parsed.issuedAt) ||
      typeof parsed.expiresAt !== "number" ||
      !Number.isFinite(parsed.expiresAt) ||
      typeof parsed.nonce !== "string" ||
      !parsed.nonce ||
      Date.now() > parsed.expiresAt
    ) {
      return null;
    }
    if (
      parsed.provider &&
      parsed.provider !== "github" &&
      parsed.provider !== "google"
    ) {
      return null;
    }
    return parsed as StepUpCookiePayload;
  } catch {
    return null;
  }
}

async function getCookieStore() {
  const { cookies } = await import("next/headers");
  return cookies();
}

function getStepUpCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.HTTPS !== "false",
    path: "/",
    maxAge,
  };
}

async function setStepUpCookie(
  name: string,
  payload: StepUpCookiePayload | null,
) {
  const cookieStore = await getCookieStore();
  if (!payload) {
    cookieStore.set(name, "", getStepUpCookieOptions(0));
    return;
  }
  const encoded = encodeStepUpCookie(payload);
  if (!encoded) return;
  cookieStore.set(name, encoded, getStepUpCookieOptions(STEP_UP_TTL_SECONDS));
}

async function readStepUpCookie(name: string) {
  const cookieStore = await getCookieStore();
  return decodeStepUpCookie(cookieStore.get(name)?.value);
}

function createStepUpPayload(args: {
  userId: string;
  method: SecretRevealStepUpMethod;
  provider?: SecretRevealSocialProvider;
}): StepUpCookiePayload {
  const now = Date.now();
  return {
    userId: args.userId,
    method: args.method,
    ...(args.provider ? { provider: args.provider } : {}),
    issuedAt: now,
    expiresAt: now + STEP_UP_TTL_SECONDS * 1_000,
    nonce: randomUUID(),
  };
}

export function sanitizeDiagnosticUrl(
  value: string | undefined,
): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    url.username = url.username ? HIDDEN_SEGMENT : "";
    url.password = url.password ? HIDDEN_SEGMENT : "";
    url.hash = url.hash ? "#hidden" : "";

    const pathSegments = url.pathname.split("/");
    const notifyIndex = pathSegments.indexOf("notify");
    if (notifyIndex !== -1 && pathSegments.length > notifyIndex + 1) {
      for (let i = notifyIndex + 1; i < pathSegments.length; i += 1) {
        if (pathSegments[i]) {
          pathSegments[i] = HIDDEN_SEGMENT;
        }
      }
      url.pathname = pathSegments.join("/");
    }

    for (const key of Array.from(url.searchParams.keys())) {
      url.searchParams.set(key, HIDDEN_SEGMENT);
    }

    return url.toString().replaceAll("%3Chidden%3E", HIDDEN_SEGMENT);
  } catch {
    return trimmed;
  }
}

export function buildNotificationConfig(
  env: Partial<NodeJS.ProcessEnv> = process.env,
): NotificationConfig {
  const isSmtpConfigured = Boolean(
    env.MAIL_HOST &&
      env.MAIL_PORT &&
      env.MAIL_FROM_ADDRESS &&
      env.MAIL_TO_ADDRESS,
  );
  const isAppriseConfigured = Boolean(env.APPRISE_URL);
  const authenticationMethod = getAuthenticationMethod(env);
  const mailPasswordSet = hasValue(env.MAIL_PASSWORD);
  const mailPasswordRevealMode = mailPasswordSet
    ? authenticationMethod === "External"
      ? "external_click"
      : "password_confirm"
    : "none";
  const appriseUrlSet = hasValue(env.APPRISE_URL);
  const sanitizedAppriseUrl = sanitizeDiagnosticUrl(env.APPRISE_URL);
  const appriseUrlHasHiddenParts =
    appriseUrlSet && sanitizedAppriseUrl !== env.APPRISE_URL?.trim();
  const appriseUrlRevealMode = appriseUrlHasHiddenParts
    ? authenticationMethod === "External"
      ? "external_click"
      : "password_confirm"
    : "none";

  return {
    isSmtpConfigured,
    isAppriseConfigured,
    variables: [
      {
        key: "MAIL_HOST",
        displayValue: env.MAIL_HOST || null,
        isSet: hasValue(env.MAIL_HOST),
        isRequired: true,
        isSensitive: false,
        revealMode: "none",
      },
      {
        key: "MAIL_PORT",
        displayValue: env.MAIL_PORT || null,
        isSet: hasValue(env.MAIL_PORT),
        isRequired: true,
        isSensitive: false,
        revealMode: "none",
      },
      {
        key: "MAIL_USERNAME",
        displayValue: env.MAIL_USERNAME || null,
        isSet: hasValue(env.MAIL_USERNAME),
        isRequired: false,
        isSensitive: false,
        revealMode: "none",
      },
      {
        key: "MAIL_PASSWORD",
        displayValue: mailPasswordSet ? MASKED_VALUE : null,
        isSet: mailPasswordSet,
        isRequired: false,
        isSensitive: true,
        revealMode: mailPasswordRevealMode,
      },
      {
        key: "MAIL_FROM_ADDRESS",
        displayValue: env.MAIL_FROM_ADDRESS || null,
        isSet: hasValue(env.MAIL_FROM_ADDRESS),
        isRequired: true,
        isSensitive: false,
        revealMode: "none",
      },
      {
        key: "MAIL_FROM_NAME",
        displayValue: env.MAIL_FROM_NAME || null,
        isSet: hasValue(env.MAIL_FROM_NAME),
        isRequired: false,
        isSensitive: false,
        revealMode: "none",
      },
      {
        key: "MAIL_TO_ADDRESS",
        displayValue: env.MAIL_TO_ADDRESS || null,
        isSet: hasValue(env.MAIL_TO_ADDRESS),
        isRequired: true,
        isSensitive: false,
        revealMode: "none",
      },
      {
        key: "APPRISE_URL",
        displayValue: sanitizedAppriseUrl,
        isSet: appriseUrlSet,
        isRequired: false,
        isSensitive: true,
        revealMode: appriseUrlRevealMode,
      },
    ],
  };
}

function getClientIp(headerStore: Headers): string {
  const forwardedFor = headerStore.get("x-forwarded-for");
  const firstForwardedIp = forwardedFor?.split(",")[0]?.trim();
  const realIp = headerStore.get("x-real-ip")?.trim();
  return (firstForwardedIp || realIp || "unknown").slice(0, 128);
}

async function verifyDiagnosticRevealAccess(
  input: { currentPassword?: string } | undefined,
  envKey: "MAIL_PASSWORD" | "APPRISE_URL",
): Promise<
  | { success: true; clientIp: string; userId: string | null }
  | { success: false; errorKey: RevealDiagnosticSecretErrorKey }
> {
  const headerStore = await headers();
  const clientIp = getClientIp(headerStore);
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
    const verifiedStepUp = await readStepUpCookie(STEP_UP_VERIFIED_COOKIE);
    if (verifiedStepUp?.userId === userId) {
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
  const clientIp = getClientIp(headerStore);
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
    hasPasskeyForUser,
    hasVerifiedTotpForUser,
  } = await import("@/lib/auth");

  return {
    password: hasCredentialPasswordAccount(userId),
    totp: hasVerifiedTotpForUser(userId),
    passkey: hasPasskeyForUser(userId),
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

  await setStepUpCookie(
    STEP_UP_PENDING_COOKIE,
    createStepUpPayload({
      userId: context.user.userId,
      method: input.method,
      provider: input.provider,
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

export async function completeSecretRevealStepUpActionImpl(): Promise<SecretRevealStepUpResult> {
  const context = await getInternalRevealContext();
  if (!context.success) {
    return { success: false, errorKey: context.errorKey };
  }

  const pendingStepUp = await readStepUpCookie(STEP_UP_PENDING_COOKIE);
  if (!pendingStepUp || pendingStepUp.userId !== context.user.userId) {
    log.warn(
      `Rejected secret reveal step-up completion for user='${context.user.userId}' from ip='${context.clientIp}' because pending proof is missing or mismatched.`,
    );
    return { success: false, errorKey: "error_step_up_failed" };
  }

  await setStepUpCookie(STEP_UP_PENDING_COOKIE, null);
  await setStepUpCookie(
    STEP_UP_VERIFIED_COOKIE,
    createStepUpPayload({
      userId: context.user.userId,
      method: pendingStepUp.method,
      provider: pendingStepUp.provider,
    }),
  );
  log.warn(
    `Secret reveal step-up completed for user='${context.user.userId}' from ip='${context.clientIp}' via method='${pendingStepUp.method}'.`,
  );
  return { success: true };
}

export async function verifySecretRevealTotpActionImpl(input: {
  code?: string;
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

  await setStepUpCookie(
    STEP_UP_VERIFIED_COOKIE,
    createStepUpPayload({
      userId: context.user.userId,
      method: "totp",
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
  const access = await verifyDiagnosticRevealAccess(input, "MAIL_PASSWORD");
  if (!access.success) {
    return { success: false, errorKey: access.errorKey };
  }

  const mailPassword = process.env.MAIL_PASSWORD;
  if (!mailPassword) {
    log.info(
      `MAIL_PASSWORD reveal requested from ip='${access.clientIp}' but no password is configured.`,
    );
    return { success: false, errorKey: "error_mail_password_not_set" };
  }

  log.warn(
    access.userId
      ? `MAIL_PASSWORD revealed after password confirmation for user='${access.userId}' from ip='${access.clientIp}'.`
      : `MAIL_PASSWORD revealed via external auth from ip='${access.clientIp}'.`,
  );
  return { success: true, value: mailPassword };
}

export async function revealAppriseUrlActionImpl(input?: {
  currentPassword?: string;
}): Promise<RevealAppriseUrlResult> {
  const access = await verifyDiagnosticRevealAccess(input, "APPRISE_URL");
  if (!access.success) {
    return { success: false, errorKey: access.errorKey };
  }

  const appriseUrl = process.env.APPRISE_URL;
  if (!appriseUrl) {
    log.info(
      `APPRISE_URL reveal requested from ip='${access.clientIp}' but no URL is configured.`,
    );
    return { success: false, errorKey: "error_apprise_url_not_set" };
  }

  log.warn(
    access.userId
      ? `APPRISE_URL revealed after password confirmation for user='${access.userId}' from ip='${access.clientIp}'.`
      : `APPRISE_URL revealed via external auth from ip='${access.clientIp}'.`,
  );
  return { success: true, value: appriseUrl };
}
