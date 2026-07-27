import type { Locale } from "@/i18n/config";
import { readApiErrorCode } from "@/lib/auth/client-api";
import { isUsernamePolicyValid } from "@/lib/username-policy";

export { normalizeApiErrorCode, readApiErrorCode } from "@/lib/auth/client-api";
export {
  normalizeLocalizedRedirectPath,
  normalizeOptionalSafeRelativePath,
  normalizeSafeRelativePath,
} from "@/lib/safe-redirect";

export type AuthSocialProvider = "github" | "google";

export function navigateToClientPath(
  path: string,
  assign: (target: string) => void = window.location.assign.bind(
    window.location,
  ),
) {
  assign(path);
}

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

export type PasswordLoginApiState = {
  errorKey?: string;
  requiresTwoFactor?: boolean;
  redirectTo?: string;
};

export async function checkSetupRequired() {
  try {
    const response = await fetch("/api/auth/setup", {
      method: "GET",
      cache: "no-store",
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function submitPasswordLogin(input: {
  identifier: string;
  password: string;
  next?: string;
  locale: Locale;
}): Promise<PasswordLoginApiState> {
  try {
    const response = await fetch("/api/login/password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    const data = (await response
      .json()
      .catch(() => ({}))) as PasswordLoginApiState;
    if (!response.ok) {
      return {
        errorKey: data.errorKey || "error_invalid_credentials",
      };
    }
    return data;
  } catch {
    return { errorKey: "error_invalid_credentials" };
  }
}

export async function precheckSocialLogin(input: {
  identifier: string;
  provider: AuthSocialProvider;
}) {
  const response = await fetch("/api/auth/social/precheck", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
  });

  if (response.status === 400) {
    return "invalid_input" as const;
  }
  if (!response.ok) {
    return "failed" as const;
  }

  const data = (await response.json()) as {
    canProceed?: unknown;
  };
  return data.canProceed === true
    ? ("allowed" as const)
    : ("unavailable" as const);
}

export async function submitSetup(input: {
  token: string;
  email: string;
  password: string;
  name: string;
  username: string;
}) {
  const response = await fetch("/api/auth/setup", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
  });

  if (response.status === 404) return "unavailable" as const;
  if (response.status === 401) return "invalid_token" as const;
  if (!response.ok) {
    return {
      errorKey: mapSetupApiErrorToMessageKey(await readApiErrorCode(response)),
    };
  }
  return "success" as const;
}

export async function submitSetupSocialContext(input: {
  token: string;
  provider: AuthSocialProvider;
  username: string;
  name: string;
}) {
  const response = await fetch("/api/auth/setup/social-context", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });

  if (response.status === 404) return "unavailable" as const;
  if (response.status === 401) return "invalid_token" as const;
  if (!response.ok) {
    return {
      errorKey: mapSetupApiErrorToMessageKey(await readApiErrorCode(response)),
    };
  }
  return "success" as const;
}
