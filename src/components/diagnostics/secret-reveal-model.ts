export type SecretRevealTarget = "mail_password" | "apprise_url";

export type SecretRevealSocialProvider = "github" | "google";

export type SecretRevealMethods = {
  password: boolean;
  totp: boolean;
  passkey: boolean;
  socialProviders: SecretRevealSocialProvider[];
};

export const SECRET_REVEAL_TARGET_STORAGE_KEY = "diagnosticSecretRevealTarget";
