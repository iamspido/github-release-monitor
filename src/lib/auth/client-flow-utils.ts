import { isUsernamePolicyValid } from "@/lib/username-policy";

export type AuthSocialProvider = "github" | "google";

export function mapOauthErrorToMessageKey(
  errorCode: string | null,
): string | null {
  if (!errorCode) return null;

  const normalized = errorCode.trim().toLowerCase();
  if (!normalized) return null;

  const oauthErrorMap: Record<string, string> = {
    signup_disabled: "error_social_signup_disabled",
    unable_to_link_account: "error_social_signup_disabled",
    user_not_found: "error_social_signup_disabled",
    oauth_provider_not_found: "error_social_provider_not_found",
    state_mismatch: "error_social_state_mismatch",
    state_not_found: "error_social_state_mismatch",
    account_already_linked_to_different_user:
      "error_social_account_linked_elsewhere",
  };

  return oauthErrorMap[normalized] || "error_social_login_failed";
}

export function isSocialErrorKey(errorKey: string | null) {
  return Boolean(errorKey?.startsWith("error_social_"));
}

export function isValidSocialUsername(value: string) {
  return isUsernamePolicyValid(value.trim());
}

export function normalizeApiErrorCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

export async function readApiErrorCode(
  response: Response,
): Promise<string | null> {
  try {
    const data = (await response.clone().json()) as {
      error?: unknown;
      code?: unknown;
    };
    return (
      normalizeApiErrorCode(data.error) || normalizeApiErrorCode(data.code)
    );
  } catch {
    return null;
  }
}

export function mapSetupApiErrorToMessageKey(errorCode: string | null) {
  if (!errorCode) return "error_setup_failed";

  const errorMap: Record<string, string> = {
    invalid_setup_token: "error_invalid_setup_token",
    invalid_json: "error_setup_invalid_payload",
    invalid_input: "error_setup_invalid_input",
    invalid_email: "error_setup_invalid_email",
    invalid_username: "error_setup_invalid_username",
    invalid_password_policy: "error_setup_invalid_password_policy",
    email_already_exists: "error_setup_email_in_use",
    user_already_exists: "error_setup_email_in_use",
    username_already_exists: "error_setup_username_in_use",
    provider_not_configured: "error_setup_provider_not_configured",
    invalid_provider: "error_setup_invalid_provider",
  };

  return errorMap[errorCode] || "error_setup_failed";
}

export function mapRegisterSocialPrecheckErrorToMessageKey(
  errorCode: string | null,
) {
  if (!errorCode) return "error_social_login_failed";

  const errorMap: Record<string, string> = {
    signup_disabled: "error_setup_unavailable",
    invalid_username: "error_setup_invalid_username",
    invalid_email: "error_setup_invalid_email",
    username_in_use: "error_setup_username_in_use",
    email_in_use: "error_setup_email_in_use",
    provider_not_configured: "error_setup_provider_not_configured",
    invalid_provider: "error_setup_invalid_provider",
  };

  return errorMap[errorCode] || "error_social_login_failed";
}
