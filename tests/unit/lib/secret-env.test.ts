import { describe, expect, it } from "vitest";
import { getAuthSmtpConfig } from "@/lib/auth/config";
import { readSecretEnvValue } from "@/lib/secret-env";

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
});
