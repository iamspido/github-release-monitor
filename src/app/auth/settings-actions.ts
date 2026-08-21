"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import {
  auth,
  canUnlinkAccountForUser,
  ensureAuthDatabaseReady,
  getSocialProviderAccountIdForUser,
  hasCredentialPasswordAccount,
  isAuthEmailVerificationEnabled,
} from "@/lib/auth";
import {
  AUTH_EMAIL_DELIVERY_TRACKING_HEADER,
  beginAuthEmailDeliveryTracking,
  consumeAuthEmailDeliveryStatus,
} from "@/lib/auth/email-delivery-status";
import { scheduleLoginMethodRemoval } from "@/lib/auth/login-method-removal-queue";
import {
  getClientIpFromHeaders,
  isLikelyEmail,
} from "@/lib/auth/request-context";
import type { SocialLoginProvider } from "@/lib/auth/social-login-intent";
import { logger } from "@/lib/logger";
import { isPasswordPolicyValid } from "@/lib/password-policy";
import { normalizeSafeRelativePath } from "@/lib/safe-redirect";

type UpdateEmailInput = {
  newEmail: string;
  callbackURL?: string;
};

type UpdatePasswordInput = {
  currentPassword?: string;
  newPassword: string;
};

export type UpdateAccountEmailResult = {
  ok: boolean;
  mode?: "updated" | "verification_sent";
  errorKey?: string;
};

export type UpdateAccountPasswordResult = {
  ok: boolean;
  mode?: "set" | "changed";
  errorKey?: string;
};

export type UnlinkSocialAccountResult = {
  ok: boolean;
  errorKey?:
    | "social_accounts_unlink_error"
    | "social_accounts_unlink_session_not_fresh";
};

async function getAuthenticatedUserId(headerStore: Headers) {
  const session = await auth.api.getSession({
    headers: headerStore,
  });
  const userId =
    typeof session?.user?.id === "string" ? session.user.id.trim() : "";
  return userId || null;
}

type AuthenticatedUser = {
  id: string;
  email: string | null;
};

async function getAuthenticatedUser(
  headerStore: Headers,
): Promise<AuthenticatedUser | null> {
  const session = await auth.api.getSession({
    headers: headerStore,
  });

  const userId =
    typeof session?.user?.id === "string" ? session.user.id.trim() : "";
  if (!userId) return null;

  const emailRaw =
    typeof session?.user?.email === "string" ? session.user.email.trim() : "";

  return {
    id: userId,
    email: emailRaw ? emailRaw.toLowerCase() : null,
  };
}

async function readErrorCodeFromResponse(response: Response): Promise<string> {
  try {
    const payload = await response.clone().json();
    const candidates = [
      payload?.code,
      payload?.error?.code,
      payload?.errorCode,
      payload?.error_code,
      payload?.error,
      payload?.message,
    ]
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter(Boolean);

    return candidates.join(" ").toLowerCase();
  } catch {
    return "";
  }
}

function isEmailAlreadyUsedError(errorText: string): boolean {
  return (
    errorText.includes("email") &&
    (errorText.includes("already") ||
      errorText.includes("exist") ||
      errorText.includes("used") ||
      errorText.includes("taken"))
  );
}

export async function updateAccountEmailAction(
  input: UpdateEmailInput,
): Promise<UpdateAccountEmailResult> {
  await ensureAuthDatabaseReady();
  const emailVerificationEnabled = isAuthEmailVerificationEnabled();
  const headerStore = await headers();
  const clientIp = getClientIpFromHeaders(headerStore);
  const normalizedEmail = input.newEmail.trim().toLowerCase();
  const callbackURL = normalizeSafeRelativePath(input.callbackURL);

  if (!isLikelyEmail(normalizedEmail)) {
    logger
      .withScope("Auth")
      .warn(
        `Rejected email update from ip='${clientIp}' due to invalid email format.`,
      );
    return { ok: false, errorKey: "account_email_invalid" };
  }

  const authenticatedUser = await getAuthenticatedUser(headerStore);
  if (!authenticatedUser) {
    logger
      .withScope("Auth")
      .warn(`Rejected email update from ip='${clientIp}' (unauthenticated).`);
    return { ok: false, errorKey: "account_auth_required" };
  }
  const { id: userId, email: sessionEmail } = authenticatedUser;

  if (sessionEmail && sessionEmail === normalizedEmail) {
    logger
      .withScope("Auth")
      .info(
        `Email update skipped for user='${userId}' from ip='${clientIp}' because target email equals current email.`,
      );
    return { ok: true, mode: "updated" };
  }

  const deliveryTrackingId = emailVerificationEnabled
    ? beginAuthEmailDeliveryTracking()
    : null;
  const authHeaders = new Headers(headerStore);
  if (deliveryTrackingId) {
    authHeaders.set(AUTH_EMAIL_DELIVERY_TRACKING_HEADER, deliveryTrackingId);
  }

  let response: Response;
  let deliveryStatus: ReturnType<typeof consumeAuthEmailDeliveryStatus> = null;
  try {
    response = await auth.api.changeEmail({
      headers: authHeaders,
      body: {
        newEmail: normalizedEmail,
        callbackURL,
      },
      asResponse: true,
    });
  } finally {
    deliveryStatus = deliveryTrackingId
      ? consumeAuthEmailDeliveryStatus(deliveryTrackingId)
      : null;
  }

  if (!response.ok) {
    const errorText = await readErrorCodeFromResponse(response);

    if (isEmailAlreadyUsedError(errorText)) {
      logger
        .withScope("Auth")
        .warn(
          `Email update rejected for user='${userId}' from ip='${clientIp}' because target email is already used (status=${response.status}, detail='${errorText || "n/a"}').`,
        );
      return { ok: false, errorKey: "account_email_already_in_use" };
    }

    if (emailVerificationEnabled) {
      logger
        .withScope("Auth")
        .warn(
          `Email update failed for user='${userId}' from ip='${clientIp}' with status=${response.status} while verification flow is enabled (detail='${errorText || "n/a"}').`,
        );
      return { ok: false, errorKey: "account_email_update_failed" };
    }

    logger
      .withScope("Auth")
      .warn(
        `Email update failed for user='${userId}' from ip='${clientIp}' with status=${response.status} (detail='${errorText || "n/a"}').`,
      );
    return { ok: false, errorKey: "account_email_update_failed" };
  }

  if (deliveryStatus === "failed") {
    logger
      .withScope("Auth")
      .warn(
        `Email update failed for user='${userId}' from ip='${clientIp}' because the verification email could not be delivered.`,
      );
    return { ok: false, errorKey: "account_email_update_failed" };
  }

  logger
    .withScope("Auth")
    .info(
      `Email update accepted for user='${userId}' from ip='${clientIp}' to '${normalizedEmail}' (verification_enabled=${emailVerificationEnabled}).`,
    );
  if (!emailVerificationEnabled) {
    revalidatePath("/", "layout");
    return { ok: true, mode: "updated" };
  }
  return { ok: true, mode: "verification_sent" };
}

export async function updateAccountPasswordAction(
  input: UpdatePasswordInput,
): Promise<UpdateAccountPasswordResult> {
  await ensureAuthDatabaseReady();
  const headerStore = await headers();
  const clientIp = getClientIpFromHeaders(headerStore);
  const newPassword = input.newPassword;
  const currentPassword =
    typeof input.currentPassword === "string" ? input.currentPassword : "";

  if (!isPasswordPolicyValid(newPassword)) {
    logger
      .withScope("Auth")
      .warn(
        `Rejected password update from ip='${clientIp}' due to unmet password policy requirements.`,
      );
    return { ok: false, errorKey: "account_password_policy_invalid" };
  }

  const userId = await getAuthenticatedUserId(headerStore);
  if (!userId) {
    logger
      .withScope("Auth")
      .warn(
        `Rejected password update from ip='${clientIp}' (unauthenticated).`,
      );
    return { ok: false, errorKey: "account_auth_required" };
  }

  const hasCredentialAccount = hasCredentialPasswordAccount(userId);
  if (hasCredentialAccount && !currentPassword.trim()) {
    logger
      .withScope("Auth")
      .warn(
        `Rejected password change for user='${userId}' from ip='${clientIp}' because current password is missing.`,
      );
    return { ok: false, errorKey: "account_password_current_required" };
  }

  const response = hasCredentialAccount
    ? await auth.api.changePassword({
        headers: headerStore,
        body: {
          currentPassword,
          newPassword,
          revokeOtherSessions: true,
        },
        asResponse: true,
      })
    : await auth.api.setPassword({
        headers: headerStore,
        body: {
          newPassword,
        },
        asResponse: true,
      });

  if (!response.ok) {
    logger
      .withScope("Auth")
      .warn(
        `Password update failed for user='${userId}' from ip='${clientIp}' with status=${response.status} (mode=${hasCredentialAccount ? "change" : "set"}).`,
      );
    if (hasCredentialAccount && response.status === 401) {
      return { ok: false, errorKey: "account_password_current_invalid" };
    }
    return { ok: false, errorKey: "account_password_update_failed" };
  }

  logger
    .withScope("Auth")
    .info(
      `Password ${hasCredentialAccount ? "changed" : "set"} for user='${userId}' from ip='${clientIp}'.`,
    );
  revalidatePath("/", "layout");
  return { ok: true, mode: hasCredentialAccount ? "changed" : "set" };
}

export async function unlinkSocialAccountAction(
  provider: SocialLoginProvider,
): Promise<UnlinkSocialAccountResult> {
  await ensureAuthDatabaseReady();
  const headerStore = await headers();
  const userId = await getAuthenticatedUserId(headerStore);
  if (!userId || (provider !== "github" && provider !== "google")) {
    return { ok: false, errorKey: "social_accounts_unlink_error" };
  }

  return scheduleLoginMethodRemoval(userId, async () => {
    const accountId = getSocialProviderAccountIdForUser(userId, provider);
    if (!accountId || !canUnlinkAccountForUser(userId, accountId)) {
      logger
        .withScope("Auth")
        .warn(
          `Rejected social account unlink for user='${userId}' because it would remove the last login method or the provider is not linked.`,
        );
      return { ok: false, errorKey: "social_accounts_unlink_error" };
    }

    try {
      const response = await auth.api.unlinkAccount({
        headers: headerStore,
        body: { accountId },
        asResponse: true,
      });
      if (!response.ok) {
        const errorText = await readErrorCodeFromResponse(response);
        const errorSummary =
          errorText.replace(/[\r\n']/g, " ").slice(0, 200) || "unknown";
        logger
          .withScope("Auth")
          .warn(
            `Failed to unlink social account provider='${provider}' for user='${userId}' with status=${response.status} error='${errorSummary}'.`,
          );
        if (
          errorText.includes("session_not_fresh") ||
          errorText.includes("session is not fresh")
        ) {
          return {
            ok: false,
            errorKey: "social_accounts_unlink_session_not_fresh",
          };
        }
        return { ok: false, errorKey: "social_accounts_unlink_error" };
      }
      logger
        .withScope("Auth")
        .info(
          `Unlinked social account provider='${provider}' for user='${userId}'.`,
        );
      return { ok: true };
    } catch (error) {
      logger
        .withScope("Auth")
        .error(`Failed to unlink social account for user='${userId}'.`, error);
      return { ok: false, errorKey: "social_accounts_unlink_error" };
    }
  });
}
