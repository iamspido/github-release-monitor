"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getLocale } from "next-intl/server";
import { normalizeLocale } from "@/i18n/config";
import { getCanonicalRoutePath } from "@/i18n/routing";
import {
  auth,
  ensureAuthDatabaseReady,
  findRegistrationConflict,
} from "@/lib/auth";
import { isAuthSignupEnabled } from "@/lib/auth/config";
import { authenticatePassword } from "@/lib/auth/password-login";
import {
  getClientIpFromHeaders,
  getLoginIdentifierLogLabel,
  isLikelyEmail,
} from "@/lib/auth/request-context";
import { logger } from "@/lib/logger";
import { isPasswordPolicyValid } from "@/lib/password-policy";
import { redirectLocalized } from "@/lib/redirect-localized";
import { normalizeLocalizedRedirectPath } from "@/lib/safe-redirect";
import { isUsernamePolicyValid } from "@/lib/username-policy";

export type LoginActionState = {
  errorKey?: string;
  requiresTwoFactor?: boolean;
  redirectTo?: string;
};

export type RegisterActionState = {
  errorKey?: string;
};

function isValidUsername(value: string) {
  return isUsernamePolicyValid(value);
}

function normalizeAuthApiErrorCode(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

const registerErrorMap: Record<string, string> = {
  user_already_exists: "error_setup_email_in_use",
  email_already_exists: "error_setup_email_in_use",
  email_already_in_use: "error_setup_email_in_use",
  email_in_use: "error_setup_email_in_use",
  username_already_exists: "error_setup_username_in_use",
  username_already_in_use: "error_setup_username_in_use",
  username_in_use: "error_setup_username_in_use",
  username_taken: "error_setup_username_in_use",
  invalid_email: "error_setup_invalid_email",
  email_invalid: "error_setup_invalid_email",
  invalid_username: "error_setup_invalid_username",
  username_invalid: "error_setup_invalid_username",
  invalid_password: "error_setup_invalid_password_policy",
  weak_password: "error_setup_invalid_password_policy",
  password_too_weak: "error_setup_invalid_password_policy",
  password_policy_violation: "error_setup_invalid_password_policy",
  signup_disabled: "error_setup_invalid_input",
  invalid_input: "error_setup_invalid_input",
};

async function getAuthApiErrorCode(response: Response) {
  try {
    const payload = (await response.clone().json()) as {
      error?: unknown;
      code?: unknown;
    };
    return (
      normalizeAuthApiErrorCode(payload.error) ||
      normalizeAuthApiErrorCode(payload.code)
    );
  } catch {
    return "";
  }
}

function mapRegisterErrorToSetupError(errorCode: string): string {
  if (!errorCode) {
    return "error_setup_failed";
  }
  return registerErrorMap[errorCode] ?? "error_setup_failed";
}

export async function login(
  _previousState: LoginActionState | undefined,
  formData: FormData,
) {
  const email = formData.get("email");
  const password = formData.get("password");
  const next = formData.get("next");
  const identifierValue = typeof email === "string" ? email.trim() : "";
  const headerStore = await headers();
  const result = await authenticatePassword({
    headers: headerStore,
    identifier: identifierValue,
    password: typeof password === "string" ? password : "",
  });

  if (!result.ok) return { errorKey: result.errorKey };
  if (result.requiresTwoFactor) return { requiresTwoFactor: true };

  revalidatePath("/", "layout");
  const locale = await getLocale();
  const finalPath = normalizeLocalizedRedirectPath(
    typeof next === "string" ? next : undefined,
    locale,
  );
  logger
    .withScope("Auth")
    .info(`Password login completed; redirecting to a localized path.`);
  return { redirectTo: `/${locale}${finalPath}` };
}

export async function register(
  _previousState: RegisterActionState | undefined,
  formData: FormData,
) {
  if (!isAuthSignupEnabled()) {
    return { errorKey: "error_setup_unavailable" };
  }

  const usernameRaw = formData.get("username");
  const emailRaw = formData.get("email");
  const passwordRaw = formData.get("password");
  const nameRaw = formData.get("name");

  const username = typeof usernameRaw === "string" ? usernameRaw.trim() : "";
  const email =
    typeof emailRaw === "string" ? emailRaw.trim().toLowerCase() : "";
  const password = typeof passwordRaw === "string" ? passwordRaw : "";
  const name = typeof nameRaw === "string" ? nameRaw.trim() : "";

  const headerStore = await headers();
  const clientIp = getClientIpFromHeaders(headerStore);
  const registrationLabel = getLoginIdentifierLogLabel(email || username);

  logger
    .withScope("Auth")
    .info(
      `Registration attempt started for ${registrationLabel} from ip='${clientIp}'.`,
    );

  if (!isValidUsername(username)) {
    return { errorKey: "error_setup_invalid_username" };
  }
  if (!isLikelyEmail(email)) {
    return { errorKey: "error_setup_invalid_email" };
  }
  if (!isPasswordPolicyValid(password)) {
    return { errorKey: "error_setup_invalid_password_policy" };
  }

  await ensureAuthDatabaseReady();

  const registrationConflict = findRegistrationConflict(username, email);
  if (registrationConflict === "username_in_use") {
    logger
      .withScope("Auth")
      .warn(
        `Registration blocked for ${registrationLabel} from ip='${clientIp}' because username is already in use.`,
      );
    return { errorKey: "error_setup_username_in_use" };
  }
  if (registrationConflict === "email_in_use") {
    logger
      .withScope("Auth")
      .warn(
        `Registration blocked for ${registrationLabel} from ip='${clientIp}' because email is already in use.`,
      );
    return { errorKey: "error_setup_email_in_use" };
  }

  const signUpBody = {
    email,
    password,
    username,
    name: name || username,
  };

  const signUpResponse = await auth.api.signUpEmail({
    headers: headerStore,
    body: signUpBody,
    asResponse: true,
  });

  if (!signUpResponse.ok) {
    const errorCode = await getAuthApiErrorCode(signUpResponse);
    const mappedKey = mapRegisterErrorToSetupError(errorCode);
    logger
      .withScope("Auth")
      .warn(
        `Registration failed for ${registrationLabel} from ip='${clientIp}' with status=${signUpResponse.status}${errorCode ? ` (error='${errorCode}')` : ""}.`,
      );
    return { errorKey: mappedKey };
  }

  logger
    .withScope("Auth")
    .info(
      `Registration successful for ${registrationLabel} from ip='${clientIp}'. Redirecting to login.`,
    );
  const locale = await getLocale();
  const loginPath = getCanonicalRoutePath("/login", normalizeLocale(locale));
  redirectLocalized(`${loginPath}?registered=1`, locale);
}

export async function logout() {
  await ensureAuthDatabaseReady();
  const headerStore = await headers();
  const clientIp = getClientIpFromHeaders(headerStore);
  logger.withScope("Auth").info(`Logout requested from ip='${clientIp}'.`);

  const signOutResponse = await auth.api.signOut({
    headers: headerStore,
    asResponse: true,
  });
  if (!signOutResponse.ok) {
    logger
      .withScope("Auth")
      .warn(
        `Sign out returned a non-success status=${signOutResponse.status} for ip='${clientIp}'.`,
      );
  }

  logger
    .withScope("Auth")
    .info(
      `User logged out from ip='${clientIp}' with status=${signOutResponse.status}.`,
    );

  revalidatePath("/");
  return { redirectTo: "/login" as const };
}
