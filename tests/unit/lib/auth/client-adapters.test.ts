// vitest globals enabled

import {
  normalizePasskeyList,
  normalizeTwoFactorEnableResponse,
  readAuthSessionSnapshot,
} from "@/lib/auth/client-adapters";

describe("Better Auth client adapters", () => {
  it("normalizes supported passkey response shapes", () => {
    expect(
      normalizePasskeyList({
        data: {
          passkeys: [
            { id: "passkey-123456", name: " Laptop ", created_at: 123 },
            { id: "passkey-abcdef" },
            { name: "missing id" },
          ],
        },
      }),
    ).toEqual([
      {
        id: "passkey-123456",
        name: "Laptop",
        createdAt: new Date(123_000).toISOString(),
      },
      { id: "passkey-abcdef", name: "passkey-", createdAt: null },
    ]);
  });

  it("reads session fields without exposing client response details", () => {
    expect(
      readAuthSessionSnapshot({
        data: { user: { email: "user@example.test", twoFactorEnabled: true } },
        isPending: true,
      }),
    ).toEqual({
      email: "user@example.test",
      isPending: true,
      twoFactorEnabled: true,
    });
  });

  it("normalizes TOTP aliases and backup codes", () => {
    expect(
      normalizeTwoFactorEnableResponse({
        data: { totpUri: " otpauth://totp/example ", backupCodes: [" a ", 1] },
      }),
    ).toEqual({
      totpURI: "otpauth://totp/example",
      backupCodes: ["a"],
    });
  });
});
