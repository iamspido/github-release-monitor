import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { nextCookies } from "better-auth/next-js";
import { twoFactor, username } from "better-auth/plugins";
import { getAuthFeatureConfig, getAuthSecret } from "@/lib/auth/config";
import { authDbPath, getAuthDb } from "@/lib/auth/db";
import {
  authEmailVerificationEnabled,
  sendChangeEmailConfirmationToCurrentEmail,
  sendNewEmailVerificationEmail,
} from "@/lib/auth/mail";
import {
  precheckSocialLogin as precheckSocialLoginWithProviderCheck,
  type SocialLoginPrecheckResult,
} from "@/lib/auth/repository";
import type { SocialLoginProvider } from "@/lib/auth/social-login-intent";
import { logger } from "@/lib/logger";
import { readSecretEnvValue } from "@/lib/secret-env";

export {
  type AuthUserExistence,
  applySocialRegistrationProfile,
  ensureInitialAuthUserProfile,
  findRegistrationConflict,
  getAuthUserIdSnapshot,
  getLinkedSocialProvidersForUser,
  hasAnyAuthUser,
  hasCredentialPasswordAccount,
  hasPasskeyForUser,
  hasValidAuthSessionForRequest,
  hasVerifiedTotpForUser,
  type RegistrationConflictResult,
  type SocialRegistrationProfileResult,
} from "@/lib/auth/repository";

export type { SocialLoginPrecheckResult };

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
// registration is routed through the separate setup-capable handler only after
// the signed registration precheck intent has been issued.
const authSocialProviders = buildSocialProviders(true);
const setupSocialProviders = buildSocialProviders(false);
const hasSocialProviders = Object.keys(authSocialProviders).length > 0;
const trustedSocialProviders = trustedSocialLinkingEnabled
  ? Object.keys(authSocialProviders)
  : [];
const authPlugins = [
  username(),
  twoFactor({
    issuer: "GitHub Release Monitor",
  }),
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
        // Better Auth only allows this for currently unverified accounts. Verified
        // accounts still require the new address to complete email verification.
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
                _request?: Request,
              ) =>
                sendChangeEmailConfirmationToCurrentEmail({
                  currentEmail: payload.user?.email,
                  newEmail: payload.newEmail,
                  confirmationUrl: payload.url,
                }),
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
              _request?: Request,
            ) => {
              const newEmail = payload.user?.email || "";
              void sendNewEmailVerificationEmail({
                newEmail,
                verificationUrl: payload.url,
              });
            },
          },
        }
      : {}),
    advanced: {
      useSecureCookies: https,
      defaultCookieAttributes: {
        secure: https,
        httpOnly: true,
        // OAuth callbacks (GitHub/Google) are cross-site navigations.
        // "strict" breaks social linking/sign-in because auth cookies are not sent.
        sameSite: "lax" as const,
      },
    },
    account: {
      accountLinking: {
        enabled: true,
        // Required for explicit account linking when provider email differs
        // (e.g. GitHub noreply/private email vs local email/password account).
        allowDifferentEmails: true,
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
    emailAndPassword: {
      enabled: true,
      disableSignUp: !signupEnabled,
    },
    ...(hasSocialProviders ? { socialProviders: authSocialProviders } : {}),
  };
}

function buildSetupAuthConfig() {
  return {
    ...buildAuthBaseConfig(),
    emailAndPassword: {
      enabled: true,
      disableSignUp: false,
    },
    ...(hasSocialProviders ? { socialProviders: setupSocialProviders } : {}),
  };
}

let authConfig: ReturnType<typeof buildAuthConfig> | null = null;
let setupAuthConfig: ReturnType<typeof buildSetupAuthConfig> | null = null;

function getAuthConfig() {
  authConfig ??= buildAuthConfig();
  return authConfig;
}

function getSetupAuthConfig() {
  setupAuthConfig ??= buildSetupAuthConfig();
  return setupAuthConfig;
}

function createAuthInstance() {
  return betterAuth(getAuthConfig());
}

function createSetupAuthInstance() {
  return betterAuth(getSetupAuthConfig());
}

type AuthInstance = ReturnType<typeof createAuthInstance>;
let authInstance: AuthInstance | null = null;
let setupAuthInstance: AuthInstance | null = null;

function getAuthInstance() {
  authInstance ??= createAuthInstance();
  return authInstance;
}

function getSetupAuthInstance() {
  setupAuthInstance ??= createSetupAuthInstance();
  return setupAuthInstance;
}

function createLazyAuth(getInstance: () => AuthInstance): AuthInstance {
  return new Proxy({} as AuthInstance, {
    get(_target, property) {
      const instance = getInstance();
      return Reflect.get(instance, property, instance);
    },
    set(_target, property, value) {
      const instance = getInstance();
      return Reflect.set(instance, property, value, instance);
    },
    has(_target, property) {
      return property in getInstance();
    },
    ownKeys() {
      return Reflect.ownKeys(getInstance());
    },
    getOwnPropertyDescriptor(_target, property) {
      const descriptor = Reflect.getOwnPropertyDescriptor(
        getInstance(),
        property,
      );
      return descriptor ? { ...descriptor, configurable: true } : undefined;
    },
  });
}

export const auth = createLazyAuth(getAuthInstance);
export const setupAuth = createLazyAuth(getSetupAuthInstance);

export function isAuthEmailVerificationEnabled() {
  return authEmailVerificationEnabled;
}

export function isSignupEnabled() {
  return signupEnabled;
}

export function isSocialProviderConfigured(provider: SocialLoginProvider) {
  if (provider === "github") {
    return Boolean(githubClientId && githubClientSecret);
  }
  return Boolean(googleClientId && googleClientSecret);
}

let authDatabaseReadyPromise: Promise<void> | null = null;

export async function ensureAuthDatabaseReady() {
  if (authDatabaseReadyPromise) {
    log.debug(
      "Auth database readiness already initialized; reusing existing promise.",
    );
    return authDatabaseReadyPromise;
  }

  authDatabaseReadyPromise = (async () => {
    log.info("Checking Better Auth database migrations.");
    const migrations = await getMigrations(getAuthConfig());
    if (migrations.toBeCreated.length > 0 || migrations.toBeAdded.length > 0) {
      log.info(
        `Applying Better Auth migrations (create=${migrations.toBeCreated.length}, add=${migrations.toBeAdded.length}).`,
      );
    } else {
      log.debug(
        "Better Auth schema already up to date (no migrations needed).",
      );
    }
    await migrations.runMigrations();
    log.info("Better Auth migration check completed.");
  })().catch((error) => {
    authDatabaseReadyPromise = null;
    log.error("Better Auth migration check failed.", error);
    throw error;
  });

  return authDatabaseReadyPromise;
}

export function precheckSocialLogin(
  identifier: string,
  provider: SocialLoginProvider,
): SocialLoginPrecheckResult {
  return precheckSocialLoginWithProviderCheck(
    identifier,
    provider,
    isSocialProviderConfigured,
  );
}
