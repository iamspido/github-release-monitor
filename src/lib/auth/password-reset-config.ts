export const DEFAULT_PASSWORD_RESET_TOKEN_TTL_SECONDS = 15 * 60;
export const MIN_PASSWORD_RESET_TOKEN_TTL_SECONDS = 60;
export const MAX_PASSWORD_RESET_TOKEN_TTL_SECONDS = 24 * 60 * 60;

export type PasswordResetTokenTtlConfig = {
  value: number;
  usedFallback: boolean;
};

export function getPasswordResetTokenTtlConfig(
  env: Partial<NodeJS.ProcessEnv> = process.env,
): PasswordResetTokenTtlConfig {
  const raw = env.AUTH_PASSWORD_RESET_TOKEN_TTL_SECONDS?.trim();
  if (!raw) {
    return {
      value: DEFAULT_PASSWORD_RESET_TOKEN_TTL_SECONDS,
      usedFallback: false,
    };
  }

  if (!/^\d+$/.test(raw)) {
    return {
      value: DEFAULT_PASSWORD_RESET_TOKEN_TTL_SECONDS,
      usedFallback: true,
    };
  }

  const parsed = Number(raw);
  if (
    !Number.isInteger(parsed) ||
    parsed < MIN_PASSWORD_RESET_TOKEN_TTL_SECONDS ||
    parsed > MAX_PASSWORD_RESET_TOKEN_TTL_SECONDS
  ) {
    return {
      value: DEFAULT_PASSWORD_RESET_TOKEN_TTL_SECONDS,
      usedFallback: true,
    };
  }

  return { value: parsed, usedFallback: false };
}
