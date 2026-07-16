import {
  getInternalRevealContext,
  getStepUpMethodsForUser,
  isStepUpMethodAvailable,
  type RevealDiagnosticSecretErrorKey,
  type SecretRevealMethodAvailability,
  verifyDiagnosticRevealAccess,
} from "@/lib/diagnostics/secret-reveal-access";
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
