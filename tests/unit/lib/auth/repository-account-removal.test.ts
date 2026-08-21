const prepareMock = vi.fn();
const originalEnv = { ...process.env };

vi.mock("@/lib/auth/db", () => ({
  getAuthDb: () => ({ prepare: prepareMock }),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    withScope: () => ({
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    }),
  },
}));

describe("auth account removal safeguards", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      AUTH_ENABLE_PASSKEY: "true",
      AUTH_GITHUB_CLIENT_ID: "github-client",
      AUTH_GITHUB_CLIENT_SECRET: "github-secret",
    };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("allows selecting one of multiple accounts from the same provider", async () => {
    prepareMock.mockImplementation((query: string) => {
      if (query.includes("FROM account")) {
        return {
          all: vi.fn(() => [
            { id: "row-1", accountId: "github-1", providerId: "github" },
            { id: "row-2", accountId: "github-2", providerId: "github" },
          ]),
        };
      }
      throw new Error(`Unexpected query: ${query}`);
    });
    const { canUnlinkAccountForUser } = await import("@/lib/auth/repository");

    expect(canUnlinkAccountForUser("user-1", "row-2")).toBe(true);
  });

  it("allows removing a credential account when another account remains", async () => {
    prepareMock.mockImplementation((query: string) => {
      if (query.includes("FROM account")) {
        return {
          all: vi.fn(() => [
            {
              id: "credential-row",
              accountId: "user-1",
              providerId: "credential",
            },
            { id: "social-row", accountId: "github-1", providerId: "github" },
          ]),
        };
      }
      throw new Error(`Unexpected query: ${query}`);
    });
    const { canUnlinkAccountForUser } = await import("@/lib/auth/repository");

    expect(canUnlinkAccountForUser("user-1", "credential-row")).toBe(true);
  });

  it("rejects removing the final account when no passkey remains", async () => {
    prepareMock.mockImplementation((query: string) => {
      if (query.includes("FROM account")) {
        return {
          all: vi.fn(() => [
            { id: "row-1", accountId: "github-1", providerId: "github" },
          ]),
        };
      }
      if (query.includes("FROM passkey")) {
        return { get: vi.fn(() => undefined) };
      }
      throw new Error(`Unexpected query: ${query}`);
    });
    const { canUnlinkAccountForUser } = await import("@/lib/auth/repository");

    expect(canUnlinkAccountForUser("user-1", "row-1")).toBe(false);
  });

  it("rejects relying on a passkey when passkey authentication is disabled", async () => {
    process.env.AUTH_ENABLE_PASSKEY = "false";
    prepareMock.mockImplementation((query: string) => {
      if (query.includes("FROM account")) {
        return {
          all: vi.fn(() => [
            { id: "row-1", accountId: "github-1", providerId: "github" },
          ]),
        };
      }
      if (query.includes("FROM passkey")) {
        return { get: vi.fn(() => ({ id: "passkey-1" })) };
      }
      throw new Error(`Unexpected query: ${query}`);
    });
    const { canUnlinkAccountForUser } = await import("@/lib/auth/repository");

    expect(canUnlinkAccountForUser("user-1", "row-1")).toBe(false);
  });

  it("allows removing the final account when an enabled passkey remains", async () => {
    prepareMock.mockImplementation((query: string) => {
      if (query.includes("FROM account")) {
        return {
          all: vi.fn(() => [
            { id: "row-1", accountId: "github-1", providerId: "github" },
          ]),
        };
      }
      if (query.includes("FROM passkey")) {
        return { get: vi.fn(() => ({ id: "passkey-1" })) };
      }
      throw new Error(`Unexpected query: ${query}`);
    });
    const { canUnlinkAccountForUser } = await import("@/lib/auth/repository");

    expect(canUnlinkAccountForUser("user-1", "row-1")).toBe(true);
  });

  it("rejects relying on a social account whose provider is disabled", async () => {
    delete process.env.AUTH_GITHUB_CLIENT_ID;
    delete process.env.AUTH_GITHUB_CLIENT_SECRET;
    prepareMock.mockImplementation((query: string) => {
      if (query.includes("FROM account")) {
        return {
          all: vi.fn(() => [
            {
              id: "credential-row",
              accountId: "user-1",
              providerId: "credential",
            },
            { id: "social-row", accountId: "github-1", providerId: "github" },
          ]),
        };
      }
      if (query.includes("FROM passkey")) {
        return { get: vi.fn(() => undefined) };
      }
      throw new Error(`Unexpected query: ${query}`);
    });
    const { canUnlinkAccountForUser } = await import("@/lib/auth/repository");

    expect(canUnlinkAccountForUser("user-1", "credential-row")).toBe(false);
  });

  it("rejects deleting the final passkey when only a disabled provider remains", async () => {
    delete process.env.AUTH_GITHUB_CLIENT_ID;
    delete process.env.AUTH_GITHUB_CLIENT_SECRET;
    prepareMock.mockImplementation((query: string) => {
      if (query.includes("FROM passkey")) {
        return { all: vi.fn(() => [{ id: "passkey-1" }]) };
      }
      if (query.includes("providerId = 'credential'")) {
        return { get: vi.fn(() => undefined) };
      }
      if (query.includes("FROM account")) {
        return {
          get: vi.fn((_userId: string, provider: string) =>
            provider === "github" ? { id: "social-row" } : undefined,
          ),
        };
      }
      throw new Error(`Unexpected query: ${query}`);
    });
    const { canDeletePasskeyForUser } = await import("@/lib/auth/repository");

    expect(canDeletePasskeyForUser("user-1", "passkey-1")).toBe(false);
  });

  it("allows deleting the final passkey when an enabled provider remains", async () => {
    prepareMock.mockImplementation((query: string) => {
      if (query.includes("FROM passkey")) {
        return { all: vi.fn(() => [{ id: "passkey-1" }]) };
      }
      if (query.includes("providerId = 'credential'")) {
        return { get: vi.fn(() => undefined) };
      }
      if (query.includes("FROM account")) {
        return {
          get: vi.fn((_userId: string, provider: string) =>
            provider === "github" ? { id: "social-row" } : undefined,
          ),
        };
      }
      throw new Error(`Unexpected query: ${query}`);
    });
    const { canDeletePasskeyForUser } = await import("@/lib/auth/repository");

    expect(canDeletePasskeyForUser("user-1", "passkey-1")).toBe(true);
  });
});
