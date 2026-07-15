const prepareMock = vi.fn();

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

    expect(
      canUnlinkAccountForUser("user-1", "github", "github-2"),
    ).toBe(true);
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

    expect(canUnlinkAccountForUser("user-1", "credential")).toBe(true);
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

    expect(canUnlinkAccountForUser("user-1", "github")).toBe(false);
  });
});
