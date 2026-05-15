"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import {
  auth,
  ensureAuthDatabaseReady,
  hasCredentialPasswordAccount,
  isAuthEmailVerificationEnabled,
} from "@/lib/auth";
import { logger } from "@/lib/logger";
import { isPasswordPolicyValid } from "@/lib/password-policy";

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

function getClientIp(headerStore: Headers): string {
  const forwardedFor = headerStore.get("x-forwarded-for");
  const firstForwardedIp = forwardedFor?.split(",")[0]?.trim();
  const realIp = headerStore.get("x-real-ip")?.trim();
  return (firstForwardedIp || realIp || "unknown").slice(0, 128);
}

function isLikelyEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function normalizeCallbackPath(value: string | undefined): string {
  if (!value) return "/";
  const trimmed = value.trim();
  if (
    !trimmed?.startsWith("/") ||
    trimmed.startsWith("//") ||
    trimmed.includes("..")
  ) {
    return "/";
  }
  return trimmed;
}

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
  const clientIp = getClientIp(headerStore);
  const normalizedEmail = input.newEmail.trim().toLowerCase();
  const callbackURL = normalizeCallbackPath(input.callbackURL);

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

  const response = await auth.api.changeEmail({
    headers: headerStore,
    body: {
      newEmail: normalizedEmail,
      callbackURL,
    },
    asResponse: true,
  });

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
  const clientIp = getClientIp(headerStore);
  const newPassword = input.newPassword.trim();
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
