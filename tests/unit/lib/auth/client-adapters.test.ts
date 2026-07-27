const mocks = vi.hoisted(() => ({
  addPasskey: vi.fn(),
  deletePasskey: vi.fn(),
  disableTwoFactor: vi.fn(),
  enableTwoFactor: vi.fn(),
  listAccounts: vi.fn(),
  listPasskeys: vi.fn(),
  verifyTotp: vi.fn(),
}));

vi.mock("@/lib/auth/client", () => ({
  authClient: {
    listAccounts: (...args: unknown[]) => mocks.listAccounts(...args),
    passkey: {
      addPasskey: (...args: unknown[]) => mocks.addPasskey(...args),
      deletePasskey: (...args: unknown[]) => mocks.deletePasskey(...args),
      listUserPasskeys: (...args: unknown[]) => mocks.listPasskeys(...args),
    },
    twoFactor: {
      disable: (...args: unknown[]) => mocks.disableTwoFactor(...args),
      enable: (...args: unknown[]) => mocks.enableTwoFactor(...args),
      verifyTotp: (...args: unknown[]) => mocks.verifyTotp(...args),
    },
  },
}));

import {
  addPasskey,
  deletePasskey,
  disableTwoFactor,
  enableTwoFactor,
  listAuthAccounts,
  listPasskeys,
  normalizePasskeyList,
  normalizeTwoFactorEnableResponse,
  readAuthSessionSnapshot,
  verifyTwoFactor,
} from "@/lib/auth/client-adapters";

describe("Better Auth client adapters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.addPasskey.mockResolvedValue({});
    mocks.deletePasskey.mockResolvedValue({});
    mocks.disableTwoFactor.mockResolvedValue({});
    mocks.enableTwoFactor.mockResolvedValue({});
    mocks.listAccounts.mockResolvedValue({ data: [] });
    mocks.listPasskeys.mockResolvedValue({ data: [] });
    mocks.verifyTotp.mockResolvedValue({});
  });

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

  it("normalizes passkey timestamps and rejects invalid entries", () => {
    const validDate = new Date("2026-07-27T10:00:00.000Z");
    expect(
      normalizePasskeyList({
        data: [
          { id: "seconds", createdAt: 1_700_000_000 },
          { id: "millis", updatedAt: 1_700_000_000_000 },
          { id: "date", updated_at: validDate },
          { id: "invalid-date", createdAt: new Date(Number.NaN) },
          null,
        ],
      }),
    ).toEqual([
      {
        id: "seconds",
        name: "seconds",
        createdAt: "2023-11-14T22:13:20.000Z",
      },
      {
        id: "millis",
        name: "millis",
        createdAt: "2023-11-14T22:13:20.000Z",
      },
      {
        id: "date",
        name: "date",
        createdAt: "2026-07-27T10:00:00.000Z",
      },
      { id: "invalid-date", name: "invalid-", createdAt: null },
    ]);
    expect(normalizePasskeyList(null)).toEqual([]);
  });

  it("returns safe defaults for malformed session and TOTP payloads", () => {
    expect(readAuthSessionSnapshot(null)).toEqual({
      email: "",
      isPending: false,
      twoFactorEnabled: false,
    });
    expect(
      normalizeTwoFactorEnableResponse({
        otpauthURL: " otpauth://totp/fallback ",
        backupCodes: [" one ", "", null],
      }),
    ).toEqual({
      totpURI: "otpauth://totp/fallback",
      backupCodes: ["one"],
    });
    expect(normalizeTwoFactorEnableResponse(null)).toEqual({
      totpURI: null,
      backupCodes: [],
    });
  });

  it("lists accounts and passkeys while rejecting client error payloads", async () => {
    mocks.listAccounts.mockResolvedValueOnce({
      data: [{ id: "account-1", providerId: "credential" }],
    });
    mocks.listPasskeys.mockResolvedValueOnce({
      data: [{ id: "passkey-1", name: "Laptop" }],
    });

    await expect(listAuthAccounts()).resolves.toEqual([
      { id: "account-1", providerId: "credential" },
    ]);
    await expect(listPasskeys()).resolves.toEqual([
      { id: "passkey-1", name: "Laptop", createdAt: null },
    ]);

    mocks.listAccounts.mockResolvedValueOnce({ error: { message: "failed" } });
    mocks.listPasskeys.mockResolvedValueOnce({ error: { message: "failed" } });
    await expect(listAuthAccounts()).rejects.toThrow("account_list_failed");
    await expect(listPasskeys()).rejects.toThrow("passkey_list_failed");
  });

  it("passes passkey mutations to Better Auth and maps client errors", async () => {
    await expect(addPasskey("Laptop")).resolves.toBe(true);
    await expect(deletePasskey("passkey-1")).resolves.toBe(true);
    expect(mocks.addPasskey).toHaveBeenCalledWith({ name: "Laptop" });
    expect(mocks.deletePasskey).toHaveBeenCalledWith({ id: "passkey-1" });

    mocks.addPasskey.mockResolvedValueOnce({ error: "failed" });
    mocks.deletePasskey.mockResolvedValueOnce({ error: "failed" });
    await expect(addPasskey()).resolves.toBe(false);
    await expect(deletePasskey("passkey-2")).resolves.toBe(false);
  });

  it("normalizes two-factor operations and their error responses", async () => {
    mocks.enableTwoFactor.mockResolvedValueOnce({
      data: {
        uri: " otpauth://totp/account ",
        backupCodes: [" first ", "second"],
      },
    });

    await expect(enableTwoFactor("password")).resolves.toEqual({
      totpURI: "otpauth://totp/account",
      backupCodes: ["first", "second"],
    });
    await expect(verifyTwoFactor("123456", true)).resolves.toBe(true);
    await expect(disableTwoFactor("password")).resolves.toBe(true);
    expect(mocks.enableTwoFactor).toHaveBeenCalledWith({
      password: "password",
    });
    expect(mocks.verifyTotp).toHaveBeenCalledWith({
      code: "123456",
      trustDevice: true,
    });
    expect(mocks.disableTwoFactor).toHaveBeenCalledWith({
      password: "password",
    });

    mocks.enableTwoFactor.mockResolvedValueOnce({ error: "failed" });
    mocks.verifyTotp.mockResolvedValueOnce({ error: "failed" });
    mocks.disableTwoFactor.mockResolvedValueOnce({ error: "failed" });
    await expect(enableTwoFactor("password")).resolves.toBeNull();
    await expect(verifyTwoFactor("000000", false)).resolves.toBe(false);
    await expect(disableTwoFactor("password")).resolves.toBe(false);
  });
});
