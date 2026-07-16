import { authClient } from "@/lib/auth/client";
import { postAuthJson } from "@/lib/auth/client-api";
import {
  type AuthSocialProvider,
  isValidSocialUsername,
  mapRegisterSocialPrecheckErrorToMessageKey,
  precheckSocialLogin,
  submitSetupSocialContext,
} from "@/lib/auth/client-flow-utils";

export type SocialClientFlowResult =
  | { status: "started" }
  | { status: "unavailable" }
  | { status: "error"; errorKey: string };

async function startSocialProvider(
  provider: AuthSocialProvider,
  callbackURL?: string,
): Promise<SocialClientFlowResult> {
  const result = await authClient.signIn.social({
    provider,
    ...(callbackURL ? { callbackURL } : {}),
  });
  return result?.error
    ? { status: "error", errorKey: "error_social_login_failed" }
    : { status: "started" };
}

export async function startLoginSocialFlow(input: {
  identifier: string;
  provider: AuthSocialProvider;
  callbackURL?: string;
}): Promise<SocialClientFlowResult> {
  const identifier = input.identifier.trim();
  if (!identifier) {
    return { status: "error", errorKey: "error_social_identifier_required" };
  }
  if (!isValidSocialUsername(identifier)) {
    return { status: "error", errorKey: "error_social_identifier_invalid" };
  }

  try {
    const precheck = await precheckSocialLogin({
      identifier,
      provider: input.provider,
    });
    if (precheck === "invalid_input") {
      return {
        status: "error",
        errorKey: "error_social_identifier_required",
      };
    }
    if (precheck === "failed") {
      return { status: "error", errorKey: "error_social_login_failed" };
    }
    if (precheck !== "allowed") {
      return { status: "unavailable" };
    }
    return startSocialProvider(input.provider, input.callbackURL);
  } catch {
    return { status: "error", errorKey: "error_social_login_failed" };
  }
}

export async function startRegistrationSocialFlow(input: {
  provider: AuthSocialProvider;
  username: string;
  email: string;
}): Promise<SocialClientFlowResult> {
  const username = input.username.trim();
  const email = input.email.trim().toLowerCase();
  if (!isValidSocialUsername(username)) {
    return { status: "error", errorKey: "error_setup_invalid_username" };
  }

  try {
    const { response, data, errorCode } = await postAuthJson<{
      canProceed: unknown;
      error: unknown;
    }>("/api/auth/register/social-precheck", {
      provider: input.provider,
      username,
      email,
    });
    if (!response.ok || data.canProceed !== true) {
      return {
        status: "error",
        errorKey: mapRegisterSocialPrecheckErrorToMessageKey(errorCode),
      };
    }
    return startSocialProvider(input.provider);
  } catch {
    return { status: "error", errorKey: "error_social_login_failed" };
  }
}

export async function startSetupSocialFlow(input: {
  token: string;
  provider: AuthSocialProvider;
  username: string;
  name: string;
  callbackURL?: string;
}): Promise<SocialClientFlowResult> {
  if (!isValidSocialUsername(input.username)) {
    return { status: "error", errorKey: "error_setup_invalid_username" };
  }

  try {
    const contextResult = await submitSetupSocialContext({
      token: input.token,
      provider: input.provider,
      username: input.username.trim(),
      name: input.name.trim(),
    });
    if (contextResult === "unavailable") return { status: "unavailable" };
    if (contextResult === "invalid_token") {
      return { status: "error", errorKey: "error_invalid_setup_token" };
    }
    if (contextResult !== "success") {
      return { status: "error", errorKey: contextResult.errorKey };
    }
    return startSocialProvider(input.provider, input.callbackURL);
  } catch {
    return { status: "error", errorKey: "error_setup_failed" };
  }
}
