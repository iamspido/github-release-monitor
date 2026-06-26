export type SecretRevealTarget = "mail_password" | "apprise_url";

export type SecretRevealSocialProvider = "github" | "google";

export type SecretRevealMethods = {
  password: boolean;
  totp: boolean;
  passkey: boolean;
  socialProviders: SecretRevealSocialProvider[];
};

export const SECRET_REVEAL_TARGET_STORAGE_KEY = "diagnosticSecretRevealTarget";

export function normalizeSecretRevealTarget(
  value: string | null | undefined,
): SecretRevealTarget {
  return value === "apprise_url" ? "apprise_url" : "mail_password";
}

export function getSecretRevealTargetFromSessionStorage(
  storage: Pick<Storage, "getItem" | "removeItem">,
): SecretRevealTarget {
  const storedTarget = storage.getItem(SECRET_REVEAL_TARGET_STORAGE_KEY);
  storage.removeItem(SECRET_REVEAL_TARGET_STORAGE_KEY);
  return normalizeSecretRevealTarget(storedTarget);
}

export function buildSecretRevealCallbackUrl(pathname: string) {
  return `${pathname || "/test"}?secretRevealStepUp=1`;
}
