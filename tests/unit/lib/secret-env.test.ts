import { describe, expect, it } from "vitest";
import { getAuthSmtpConfig } from "@/lib/auth/config";
import {
  normalizeAccessTokenEnvValue,
  readSecretEnvValue,
} from "@/lib/secret-env";

describe("secret environment values", () => {
  it("preserves meaningful whitespace exactly", () => {
    expect(readSecretEnvValue("  secret with spaces  ")).toBe(
      "  secret with spaces  ",
    );
  });

  it("treats only empty and whitespace-only values as unset", () => {
    expect(readSecretEnvValue(undefined)).toBeNull();
    expect(readSecretEnvValue("")).toBeNull();
    expect(readSecretEnvValue("   ")).toBeNull();
  });

  it("does not trim an SMTP password", () => {
    const config = getAuthSmtpConfig({
      MAIL_HOST: "smtp.example.test",
      MAIL_PORT: "587",
      MAIL_FROM_ADDRESS: "from@example.test",
      MAIL_PASSWORD: " password ",
    });

    expect(config.password).toBe(" password ");
  });

  it.each(["invalid", "587suffix", "0", "65536", "-1", "5.5"])(
    "does not enable auth email verification when MAIL_PORT is %s",
    (port) => {
      const config = getAuthSmtpConfig({
        MAIL_HOST: "smtp.example.test",
        MAIL_PORT: port,
        MAIL_FROM_ADDRESS: "from@example.test",
      });

      expect(config.emailVerificationEnabled).toBe(false);
      expect(config.port).toBeNaN();
    },
  );

  it.each(["1", "587", "65535"])(
    "enables auth email verification for valid MAIL_PORT %s",
    (port) => {
      const config = getAuthSmtpConfig({
        MAIL_HOST: "smtp.example.test",
        MAIL_PORT: port,
        MAIL_FROM_ADDRESS: "from@example.test",
      });

      expect(config.emailVerificationEnabled).toBe(true);
      expect(config.port).toBe(Number(port));
    },
  );

  it("uses fail-safe SMTP TLS certificate verification defaults", () => {
    expect(getAuthSmtpConfig({}).tlsRejectUnauthorized).toBe(true);
    expect(
      getAuthSmtpConfig({ MAIL_TLS_REJECT_UNAUTHORIZED: "invalid" })
        .tlsRejectUnauthorized,
    ).toBe(true);
    expect(
      getAuthSmtpConfig({ MAIL_TLS_REJECT_UNAUTHORIZED: "false" })
        .tlsRejectUnauthorized,
    ).toBe(false);
  });

  it.each([
    ["  github-token  ", "github-token"],
    [' "github-token" ', "github-token"],
    [" 'github-token' ", "github-token"],
    [' "ghp_\n abc" ', "ghp_abc"],
    ["   ", null],
    [' " " ', null],
  ])("normalizes provider access token %j", (input, expected) => {
    expect(normalizeAccessTokenEnvValue(input)).toBe(expected);
  });
});
