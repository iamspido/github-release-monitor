import { readSecretEnvValue } from "@/lib/secret-env";
import {
  parseSmtpPort,
  parseSmtpTlsRejectUnauthorized,
} from "@/lib/smtp-config";

export type AuthSocialProvider = "github" | "google";

type AuthEnv = Partial<NodeJS.ProcessEnv>;

function hasEnvValue(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

export function getAuthSecret(env: AuthEnv = process.env): string {
  return env.BETTER_AUTH_SECRET || env.AUTH_SECRET || "";
}

export function getAuthCookieSecret(env: AuthEnv = process.env): string {
  return getAuthSecret(env) || env.AUTH_SETUP_TOKEN || "";
}

export function getAuthSetupToken(env: AuthEnv = process.env): string {
  return env.AUTH_SETUP_TOKEN || "";
}

export function isAuthSetupTokenConfigured(
  env: AuthEnv = process.env,
): boolean {
  return getAuthSetupToken(env).length >= 32;
}

export function isAuthSignupEnabled(env: AuthEnv = process.env): boolean {
  return env.AUTH_ENABLE_SIGNUP === "true";
}

export function isAuthPasskeyEnabled(env: AuthEnv = process.env): boolean {
  return env.AUTH_ENABLE_PASSKEY !== "false";
}

export function isTrustedSocialLinkingEnabled(
  env: AuthEnv = process.env,
): boolean {
  return env.AUTH_TRUST_SOCIAL_LINKING !== "false";
}

export function isSocialProviderConfigured(
  provider: AuthSocialProvider,
  env: AuthEnv = process.env,
): boolean {
  if (provider === "github") {
    return (
      hasEnvValue(env.AUTH_GITHUB_CLIENT_ID) &&
      hasEnvValue(env.AUTH_GITHUB_CLIENT_SECRET)
    );
  }
  return (
    hasEnvValue(env.AUTH_GOOGLE_CLIENT_ID) &&
    hasEnvValue(env.AUTH_GOOGLE_CLIENT_SECRET)
  );
}

export function getEnabledSocialProviders(
  env: AuthEnv = process.env,
): AuthSocialProvider[] {
  return (["github", "google"] as const).filter((provider) =>
    isSocialProviderConfigured(provider, env),
  );
}

export function getAuthFeatureConfig(env: AuthEnv = process.env) {
  return {
    signupEnabled: isAuthSignupEnabled(env),
    passkeyEnabled: isAuthPasskeyEnabled(env),
    trustedSocialLinkingEnabled: isTrustedSocialLinkingEnabled(env),
    enabledSocialProviders: getEnabledSocialProviders(env),
  };
}

export function getAuthSmtpConfig(env: AuthEnv = process.env) {
  const smtpPort = parseSmtpPort(env.MAIL_PORT);
  const smtpHost = env.MAIL_HOST?.trim() || "";
  const smtpFromAddress = env.MAIL_FROM_ADDRESS?.trim() || "";

  return {
    host: smtpHost,
    port: smtpPort,
    fromAddress: smtpFromAddress,
    fromName: env.MAIL_FROM_NAME?.trim() || "GitHub Release Monitor",
    username: env.MAIL_USERNAME?.trim() || "",
    password: readSecretEnvValue(env.MAIL_PASSWORD) ?? "",
    tlsRejectUnauthorized: parseSmtpTlsRejectUnauthorized(
      env.MAIL_TLS_REJECT_UNAUTHORIZED,
    ),
    emailVerificationEnabled:
      smtpHost.length > 0 &&
      Number.isFinite(smtpPort) &&
      smtpFromAddress.length > 0,
  };
}
