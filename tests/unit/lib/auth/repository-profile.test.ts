import { beforeEach, describe, expect, it, vi } from "vitest";

const prepareMock = vi.fn();
const linkedSocialAccountMock = vi.fn();

vi.mock("@/lib/auth/db", () => ({
  getAuthDb: () => ({ prepare: prepareMock }),
}));

vi.mock("@/lib/auth/repository-login-methods", () => ({
  canDeletePasskeyForUser: vi.fn(),
  canUnlinkAccountForUser: vi.fn(),
  canUnlinkSocialProviderForUser: vi.fn(),
  getLinkedSocialProvidersForUser: vi.fn(),
  hasCredentialPasswordAccount: vi.fn(),
  hasLinkedSocialProviderAccount: (...args: unknown[]) =>
    linkedSocialAccountMock(...args),
  hasPasskeyForUser: vi.fn(),
  hasVerifiedTotpForUser: vi.fn(),
}));

vi.mock("@/lib/logger", () => {
  const scoped = {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };
  return { logger: { withScope: () => scoped } };
});

describe("auth repository profiles and registration lookups", () => {
  beforeEach(() => {
    prepareMock.mockReset();
    linkedSocialAccountMock.mockReset();
  });

  it("normalizes and fills only missing initial profile fields", async () => {
    const updateUsername = vi.fn();
    const updateName = vi.fn();
    prepareMock.mockImplementation((query: string) => {
      if (query.startsWith("SELECT id, email")) {
        return {
          get: vi.fn(() => ({
            id: "user-1",
            email: "admin@example.test",
            username: " ",
            name: null,
          })),
        };
      }
      if (query.includes("SET username")) return { run: updateUsername };
      if (query.includes("SET name")) return { run: updateName };
      throw new Error(`Unexpected query: ${query}`);
    });
    const { ensureInitialAuthUserProfile } = await import(
      "@/lib/auth/repository"
    );

    expect(
      ensureInitialAuthUserProfile({
        username: " Admin.User ",
        name: " Administrator ",
      }),
    ).toEqual({
      email: "admin@example.test",
      usernameApplied: true,
      nameApplied: true,
    });
    expect(updateUsername).toHaveBeenCalledWith("admin.user", "user-1");
    expect(updateName).toHaveBeenCalledWith("Administrator", "user-1");
  });

  it("does not overwrite an existing initial profile", async () => {
    prepareMock.mockReturnValue({
      get: vi.fn(() => ({
        id: "user-1",
        email: null,
        username: "existing",
        name: "Existing Name",
      })),
    });
    const { ensureInitialAuthUserProfile } = await import(
      "@/lib/auth/repository"
    );

    expect(
      ensureInitialAuthUserProfile({
        username: "replacement",
        name: "Replacement",
      }),
    ).toEqual({
      email: null,
      usernameApplied: false,
      nameApplied: false,
    });
    expect(prepareMock).toHaveBeenCalledTimes(1);
  });

  it("returns null for an empty username, missing user, or database error", async () => {
    const { ensureInitialAuthUserProfile } = await import(
      "@/lib/auth/repository"
    );
    expect(ensureInitialAuthUserProfile({ username: " " })).toBeNull();
    expect(prepareMock).not.toHaveBeenCalled();

    prepareMock.mockReturnValueOnce({ get: vi.fn(() => undefined) });
    expect(ensureInitialAuthUserProfile({ username: "admin" })).toBeNull();

    prepareMock.mockImplementationOnce(() => {
      throw new Error("database unavailable");
    });
    expect(ensureInitialAuthUserProfile({ username: "admin" })).toBeNull();
  });

  it.each([
    ["username_in_use", "Admin", "new@example.test", "username"],
    ["email_in_use", "new-user", "USED@EXAMPLE.TEST", "email"],
    ["none", "new-user", "new@example.test", "none"],
  ] as const)(
    "returns %s for registration conflicts",
    async (expected, username, email, conflictSource) => {
      prepareMock.mockImplementation((query: string) => ({
        get: vi.fn(() => {
          if (query.includes("lower(username)")) {
            return conflictSource === "username" ? { id: "user-1" } : undefined;
          }
          if (query.includes("lower(email)")) {
            return conflictSource === "email" ? { id: "user-1" } : undefined;
          }
          throw new Error(`Unexpected query: ${query}`);
        }),
      }));
      const { findRegistrationConflict } = await import(
        "@/lib/auth/repository"
      );

      expect(findRegistrationConflict(username, email)).toBe(expected);
    },
  );

  it("captures only non-empty auth user ids in a snapshot", async () => {
    prepareMock.mockReturnValue({
      all: vi.fn(() => [
        { id: " user-1 " },
        { id: "" },
        { id: null },
        { id: "user-2" },
      ]),
    });
    const { getAuthUserIdSnapshot } = await import("@/lib/auth/repository");

    expect(getAuthUserIdSnapshot()).toEqual(new Set(["user-1", "user-2"]));
  });

  it("applies a normalized social registration profile to the one new user", async () => {
    const update = vi.fn();
    prepareMock.mockImplementation((query: string) => {
      if (query === "SELECT id, email, username FROM user") {
        return {
          all: vi.fn(() => [
            { id: "existing-user", email: "old@example.test" },
            { id: "new-user", email: "provider@example.test" },
          ]),
        };
      }
      if (query.includes("lower(username)")) {
        return { get: vi.fn(() => undefined) };
      }
      if (query === "PRAGMA table_info(user)") {
        return {
          all: vi.fn(() => [
            { name: "username" },
            { name: "displayUsername" },
            { name: "updatedAt" },
          ]),
        };
      }
      if (query.startsWith("UPDATE user SET")) return { run: update };
      throw new Error(`Unexpected query: ${query}`);
    });
    const { applySocialRegistrationProfile } = await import(
      "@/lib/auth/repository"
    );

    expect(
      applySocialRegistrationProfile({
        previousUserIds: new Set(["existing-user"]),
        username: " Admin.User ",
        email: "precheck@example.test",
      }),
    ).toBe("applied");
    expect(prepareMock).toHaveBeenCalledWith(
      "UPDATE user SET username = ?, displayUsername = ?, updatedAt = ? WHERE id = ?",
    );
    expect(update).toHaveBeenCalledWith(
      "admin.user",
      "Admin.User",
      expect.any(Date),
      "new-user",
    );
  });

  it.each([
    ["invalid_username", "no-new-user", "bad-user"],
    ["no_new_user", "no-new-user", "valid.user"],
    ["ambiguous_new_user", "ambiguous", "valid.user"],
  ] as const)(
    "returns %s before updating a social profile",
    async (expected, rowsMode, username) => {
      prepareMock.mockImplementation((query: string) => {
        if (query !== "SELECT id, email, username FROM user") {
          throw new Error(`Unexpected query: ${query}`);
        }
        return {
          all: vi.fn(() =>
            rowsMode === "ambiguous"
              ? [{ id: "new-1" }, { id: "new-2" }]
              : [{ id: "existing-user" }],
          ),
        };
      });
      const { applySocialRegistrationProfile } = await import(
        "@/lib/auth/repository"
      );

      expect(
        applySocialRegistrationProfile({
          previousUserIds: new Set(["existing-user"]),
          username,
        }),
      ).toBe(expected);
    },
  );

  it("rejects a social profile when another user owns the username", async () => {
    prepareMock.mockImplementation((query: string) => {
      if (query === "SELECT id, email, username FROM user") {
        return { all: vi.fn(() => [{ id: "new-user" }]) };
      }
      if (query.includes("lower(username)")) {
        return { get: vi.fn(() => ({ id: "other-user" })) };
      }
      throw new Error(`Unexpected query: ${query}`);
    });
    const { applySocialRegistrationProfile } = await import(
      "@/lib/auth/repository"
    );

    expect(
      applySocialRegistrationProfile({
        previousUserIds: new Set(),
        username: "valid.user",
      }),
    ).toBe("username_in_use");
  });

  it("reports a missing username column and a failed update", async () => {
    const rows = [{ id: "new-user" }];
    prepareMock.mockImplementation((query: string) => {
      if (query === "SELECT id, email, username FROM user") {
        return { all: vi.fn(() => rows) };
      }
      if (query.includes("lower(username)")) {
        return { get: vi.fn(() => undefined) };
      }
      if (query === "PRAGMA table_info(user)") {
        return { all: vi.fn(() => [{ name: "email" }]) };
      }
      throw new Error(`Unexpected query: ${query}`);
    });
    const { applySocialRegistrationProfile } = await import(
      "@/lib/auth/repository"
    );

    expect(
      applySocialRegistrationProfile({
        previousUserIds: new Set(),
        username: "valid.user",
      }),
    ).toBe("username_column_missing");

    prepareMock.mockImplementation((query: string) => {
      if (query === "SELECT id, email, username FROM user") {
        return { all: vi.fn(() => rows) };
      }
      if (query.includes("lower(username)")) {
        return { get: vi.fn(() => undefined) };
      }
      if (query === "PRAGMA table_info(user)") {
        return { all: vi.fn(() => [{ name: "username" }]) };
      }
      if (query.startsWith("UPDATE user SET")) {
        return {
          run: vi.fn(() => {
            throw new Error("constraint failed");
          }),
        };
      }
      throw new Error(`Unexpected query: ${query}`);
    });

    expect(
      applySocialRegistrationProfile({
        previousUserIds: new Set(),
        username: "valid.user",
      }),
    ).toBe("update_failed");
  });

  it("prechecks configured social providers by username and email", async () => {
    prepareMock.mockImplementation((query: string) => ({
      get: vi.fn(() => {
        if (query.includes("lower(username)")) return undefined;
        if (query.includes("lower(email)")) return { id: "user-1" };
        throw new Error(`Unexpected query: ${query}`);
      }),
    }));
    linkedSocialAccountMock.mockReturnValue(true);
    const { precheckSocialLogin } = await import("@/lib/auth/repository");
    const configured = vi.fn(() => true);

    expect(
      precheckSocialLogin(" ADMIN@EXAMPLE.TEST ", "github", configured),
    ).toBe("linked");
    expect(linkedSocialAccountMock).toHaveBeenCalledWith("user-1", "github");
  });

  it("rejects invalid or disabled social-login prechecks without database work", async () => {
    const { precheckSocialLogin } = await import("@/lib/auth/repository");

    expect(precheckSocialLogin(" ", "github", () => true)).toBe(
      "invalid_input",
    );
    expect(precheckSocialLogin("admin", "github", () => false)).toBe(
      "provider_not_configured",
    );
    expect(prepareMock).not.toHaveBeenCalled();
  });
});
