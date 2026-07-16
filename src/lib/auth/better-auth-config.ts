import { passkey } from "@better-auth/passkey";
import { nextCookies } from "better-auth/next-js";
import { twoFactor, username } from "better-auth/plugins";
import { getAuthFeatureConfig, getAuthSecret } from "@/lib/auth/config";
import { authDbPath, getAuthDb } from "@/lib/auth/db";
import { runTrackedAuthEmailDelivery } from "@/lib/auth/email-delivery-status";
import {
  authEmailVerificationEnabled,
  sendChangeEmailConfirmationToCurrentEmail,
  sendNewEmailVerificationEmail,
} from "@/lib/auth/mail";
import type { SocialLoginProvider } from "@/lib/auth/social-login-intent";
import { logger } from "@/lib/logger";
import { readSecretEnvValue } from "@/lib/secret-env";

const log = logger.withScope("Auth");
const https = process.env.HTTPS !== "false";
const authFeatureConfig = getAuthFeatureConfig();
const signupEnabled = authFeatureConfig.signupEnabled;
const passkeyEnabled = authFeatureConfig.passkeyEnabled;
const trustedSocialLinkingEnabled =
  authFeatureConfig.trustedSocialLinkingEnabled;
const secret = getAuthSecret();
const githubClientId = process.env.AUTH_GITHUB_CLIENT_ID?.trim();
const githubClientSecret = readSecretEnvValue(
  process.env.AUTH_GITHUB_CLIENT_SECRET,
);
const googleClientId = process.env.AUTH_GOOGLE_CLIENT_ID?.trim();
const googleClientSecret = readSecretEnvValue(
  process.env.AUTH_GOOGLE_CLIENT_SECRET,
);

function buildSocialProviders(disableImplicitSignUp: boolean) {
  return {
    ...(githubClientId && githubClientSecret
      ? {
          github: {
            clientId: githubClientId,
            clientSecret: githubClientSecret,
            scope: ["read:user", "user:email"],
            disableImplicitSignUp,
          },
        }
      : {}),
    ...(googleClientId && googleClientSecret
      ? {
          google: {
            clientId: googleClientId,
            clientSecret: googleClientSecret,
            scope: ["openid", "profile", "email"],
            disableImplicitSignUp,
          },
        }
      : {}),
  };
}

// Normal sign-in must never create an account implicitly. Explicit social
// registration uses the setup-capable instance after a signed precheck.
const authSocialProviders = buildSocialProviders(true);
const setupSocialProviders = buildSocialProviders(false);
const hasSocialProviders = Object.keys(authSocialProviders).length > 0;
const trustedSocialProviders = trustedSocialLinkingEnabled
  ? Object.keys(authSocialProviders)
  : [];
const authPlugins = [
  username(),
  twoFactor({ issuer: "GitHub Release Monitor" }),
  ...(passkeyEnabled ? [passkey()] : []),
  nextCookies(),
];

const configuredSocialProviders = Object.keys(authSocialProviders);
log.info(
  `Better Auth boot config: db='${authDbPath}', signup_enabled=${signupEnabled}, passkey_enabled=${passkeyEnabled}, trusted_social_linking=${trustedSocialLinkingEnabled}, social_providers=${
    configuredSocialProviders.length > 0
      ? configuredSocialProviders.join(",")
      : "none"
  }, secure_cookies=${https}, email_change_verification=${authEmailVerificationEnabled}.`,
);

if (!secret || secret.length < 32) {
  const message =
    "CRITICAL: Missing or insecure BETTER_AUTH_SECRET (or AUTH_SECRET fallback). Must be at least 32 characters long.";
  log.error(message);
  throw new Error(message);
}

function buildAuthBaseConfig() {
  return {
    database: getAuthDb(),
    secret,
    baseURL: process.env.BETTER_AUTH_URL || process.env.BETTER_AUTH_BASE_URL,
    user: {
      changeEmail: {
        enabled: true,
        updateEmailWithoutVerification: !authEmailVerificationEnabled,
        ...(authEmailVerificationEnabled
          ? {
              sendChangeEmailConfirmation: async (
                payload: {
                  user: { email: string };
                  newEmail: string;
                  url: string;
                  token: string;
                },
                request?: Request,
              ) =>
                runTrackedAuthEmailDelivery(request, () =>
                  sendChangeEmailConfirmationToCurrentEmail({
                    currentEmail: payload.user?.email,
                    newEmail: payload.newEmail,
                    confirmationUrl: payload.url,
                  }),
                ),
            }
          : {}),
      },
    },
    ...(authEmailVerificationEnabled
      ? {
          emailVerification: {
            sendVerificationEmail: async (
              payload: {
                user: { email: string };
                url: string;
                token: string;
              },
              request?: Request,
            ) => {
              const newEmail = payload.user?.email || "";
              await runTrackedAuthEmailDelivery(request, () =>
                sendNewEmailVerificationEmail({
                  newEmail,
                  verificationUrl: payload.url,
                }),
              );
            },
          },
        }
      : {}),
    advanced: {
      useSecureCookies: https,
      defaultCookieAttributes: {
        secure: https,
        httpOnly: true,
        sameSite: "lax" as const,
      },
    },
    account: {
      accountLinking: {
        enabled: true,
        allowDifferentEmails: true,
        allowUnlinkingAll: true,
        ...(trustedSocialProviders.length > 0
          ? { trustedProviders: trustedSocialProviders }
          : {}),
      },
    },
    plugins: authPlugins,
  };
}

function buildAuthConfig() {
  return {
    ...buildAuthBaseConfig(),
    emailAndPassword: { enabled: true, disableSignUp: !signupEnabled },
    ...(hasSocialProviders ? { socialProviders: authSocialProviders } : {}),
  };
}

function buildSetupAuthConfig() {
  return {
    ...buildAuthBaseConfig(),
    emailAndPassword: { enabled: true, disableSignUp: false },
    ...(hasSocialProviders ? { socialProviders: setupSocialProviders } : {}),
  };
}

let authConfig: ReturnType<typeof buildAuthConfig> | null = null;
let setupAuthConfig: ReturnType<typeof buildSetupAuthConfig> | null = null;

export function getBetterAuthConfig() {
  authConfig ??= buildAuthConfig();
  return authConfig;
}

export function getSetupBetterAuthConfig() {
  setupAuthConfig ??= buildSetupAuthConfig();
  return setupAuthConfig;
}

export function isAuthEmailVerificationEnabled() {
  return authEmailVerificationEnabled;
}

export function isSignupEnabled() {
  return signupEnabled;
}

export function isSocialProviderConfigured(
  provider: SocialLoginProvider,
): boolean {
  return provider === "github"
    ? Boolean(githubClientId && githubClientSecret)
    : Boolean(googleClientId && googleClientSecret);
}
