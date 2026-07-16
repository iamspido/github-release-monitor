import { headers } from "next/headers";
import { getCurrentAuthAccess } from "@/lib/auth/access";
import { getClientIpFromHeaders } from "@/lib/auth/request-context";
import { consumeSecretRevealStepUpNonce } from "@/lib/diagnostics/secret-reveal-nonce-store";
import {
  readSecretRevealStepUpCookie,
  SECRET_REVEAL_VERIFIED_COOKIE,
  type SecretRevealSocialProvider,
  type SecretRevealStepUpMethod,
  type SecretRevealTarget,
  setSecretRevealStepUpCookie,
} from "@/lib/diagnostics/secret-reveal-step-up";
import { logger } from "@/lib/logger";

const log = logger.withScope("Diagnostics");

export type SecretRevealMethodAvailability = {
  password: boolean;
  totp: boolean;
  passkey: boolean;
  socialProviders: SecretRevealSocialProvider[];
};

export type RevealDiagnosticSecretErrorKey =
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

export async function verifyDiagnosticRevealAccess(
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
  const session = await auth.api.getSession({ headers: headerStore });
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
      consumeSecretRevealStepUpNonce(
        verifiedStepUp.nonce,
        verifiedStepUp.expiresAt,
      )
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
  const session = await auth.api.getSession({ headers: headerStore });
  const userId =
    typeof session?.user?.id === "string" ? session.user.id.trim() : "";
  const email =
    typeof session?.user?.email === "string"
      ? session.user.email.trim().toLowerCase()
      : "";
  return userId ? { userId, email } : null;
}

export async function getInternalRevealContext() {
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

export async function getStepUpMethodsForUser(
  userId: string,
): Promise<SecretRevealMethodAvailability> {
  const {
    getLinkedSocialProvidersForUser,
    hasCredentialPasswordAccount,
    hasVerifiedTotpForUser,
  } = await import("@/lib/auth");

  return {
    password: hasCredentialPasswordAccount(userId),
    totp: hasVerifiedTotpForUser(userId),
    // A client-side passkey sign-in is not a fresh server-verifiable assertion.
    passkey: false,
    socialProviders: getLinkedSocialProvidersForUser(userId),
  };
}

export function isStepUpMethodAvailable(
  methods: SecretRevealMethodAvailability,
  method: SecretRevealStepUpMethod,
  provider?: SecretRevealSocialProvider,
): boolean {
  if (method === "password") return methods.password;
  if (method === "totp") return methods.totp;
  if (method === "passkey") return methods.passkey;
  if (method === "social") {
    return provider ? methods.socialProviders.includes(provider) : false;
  }
  return false;
}
