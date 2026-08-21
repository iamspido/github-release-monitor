const mocks = vi.hoisted(() => ({
  betterAuth: vi.fn(),
  getMigrations: vi.fn(),
  runMigrations: vi.fn(),
  migrateAuthAccountIdentities: vi.fn(),
}));

vi.mock("@/lib/auth/account-identity-migration", () => ({
  migrateAuthAccountIdentities: mocks.migrateAuthAccountIdentities,
}));

vi.mock("better-auth", () => ({
  betterAuth: (...args: unknown[]) => mocks.betterAuth(...args),
}));

vi.mock("better-auth/db/migration", () => ({
  getMigrations: (...args: unknown[]) => mocks.getMigrations(...args),
}));

vi.mock("@/lib/auth/better-auth-config", () => ({
  getBetterAuthConfig: () => ({ mode: "normal" }),
  getSetupBetterAuthConfig: () => ({ mode: "setup" }),
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

describe("auth/bootstrap", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.runMigrations.mockResolvedValue(undefined);
    mocks.migrateAuthAccountIdentities.mockReturnValue(false);
    mocks.getMigrations.mockResolvedValue({
      toBeAdded: [],
      toBeCreated: [],
      runMigrations: mocks.runMigrations,
    });
    mocks.betterAuth.mockImplementation((config: unknown) => ({
      config,
      api: { signOut: vi.fn() },
    }));
  });

  it("creates normal and setup auth instances lazily", async () => {
    const { auth, setupAuth } = await import("@/lib/auth/bootstrap");

    expect(mocks.betterAuth).not.toHaveBeenCalled();
    expect(auth.api).toBeTruthy();
    expect(mocks.betterAuth).toHaveBeenNthCalledWith(1, { mode: "normal" });
    expect(auth.api).toBe(auth.api);
    expect(mocks.betterAuth).toHaveBeenCalledTimes(1);

    expect(setupAuth.api).toBeTruthy();
    expect(mocks.betterAuth).toHaveBeenNthCalledWith(2, { mode: "setup" });
  });

  it("shares one migration run between concurrent readiness calls", async () => {
    let finishMigration: (() => void) | undefined;
    mocks.runMigrations.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishMigration = resolve;
      }),
    );
    const { ensureAuthDatabaseReady } = await import("@/lib/auth/bootstrap");

    const first = ensureAuthDatabaseReady();
    const second = ensureAuthDatabaseReady();
    await vi.waitFor(() => expect(mocks.runMigrations).toHaveBeenCalledOnce());

    expect(mocks.getMigrations).toHaveBeenCalledOnce();
    finishMigration?.();
    await expect(Promise.all([first, second])).resolves.toEqual([
      undefined,
      undefined,
    ]);
  });

  it("resets failed readiness state so a later call can retry", async () => {
    mocks.runMigrations
      .mockRejectedValueOnce(new Error("migration failed"))
      .mockResolvedValueOnce(undefined);
    const { ensureAuthDatabaseReady } = await import("@/lib/auth/bootstrap");

    await expect(ensureAuthDatabaseReady()).rejects.toThrow("migration failed");
    await expect(ensureAuthDatabaseReady()).resolves.toBeUndefined();

    expect(mocks.getMigrations).toHaveBeenCalledTimes(2);
    expect(mocks.runMigrations).toHaveBeenCalledTimes(2);
  });
});
