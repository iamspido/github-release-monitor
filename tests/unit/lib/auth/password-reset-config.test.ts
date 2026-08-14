import {
  DEFAULT_PASSWORD_RESET_TOKEN_TTL_SECONDS,
  getPasswordResetTokenTtlConfig,
} from "@/lib/auth/password-reset-config";

describe("password reset token TTL configuration", () => {
  it("uses the 15-minute default when unset", () => {
    expect(getPasswordResetTokenTtlConfig({})).toEqual({
      value: DEFAULT_PASSWORD_RESET_TOKEN_TTL_SECONDS,
      usedFallback: false,
    });
  });

  it.each([60, 900, 3600, 86400])("accepts %i seconds", (value) => {
    expect(
      getPasswordResetTokenTtlConfig({
        AUTH_PASSWORD_RESET_TOKEN_TTL_SECONDS: String(value),
      }),
    ).toEqual({ value, usedFallback: false });
  });

  it.each(["0", "59", "86401", "1.5", "1e3", "0x384", "+900", "invalid"])(
    "falls back for invalid value %s",
    (value) => {
      expect(
        getPasswordResetTokenTtlConfig({
          AUTH_PASSWORD_RESET_TOKEN_TTL_SECONDS: value,
        }),
      ).toEqual({
        value: DEFAULT_PASSWORD_RESET_TOKEN_TTL_SECONDS,
        usedFallback: true,
      });
    },
  );
});
