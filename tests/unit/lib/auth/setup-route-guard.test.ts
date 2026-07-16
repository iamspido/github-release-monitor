// vitest globals enabled

const mocks = vi.hoisted(() => ({
  ensureReady: vi.fn(),
  hasAnyUser: vi.fn(),
  isLocked: vi.fn(),
  isTokenConfigured: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  ensureAuthDatabaseReady: mocks.ensureReady,
  hasAnyAuthUser: mocks.hasAnyUser,
}));

vi.mock("@/lib/auth/config", () => ({
  isAuthSetupTokenConfigured: mocks.isTokenConfigured,
}));

vi.mock("@/lib/auth/setup-lock", () => ({
  isAuthSetupLocked: mocks.isLocked,
}));

describe("setup route guard", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.ensureReady.mockResolvedValue(undefined);
    mocks.hasAnyUser.mockReturnValue("no_user");
    mocks.isLocked.mockResolvedValue(false);
    mocks.isTokenConfigured.mockReturnValue(true);
  });

  it("checks setup conditions in fail-closed order", async () => {
    const { getAuthSetupAvailability } = await import(
      "@/lib/auth/setup-route-guard"
    );

    await expect(getAuthSetupAvailability()).resolves.toBe("available");
    expect(mocks.ensureReady).toHaveBeenCalledOnce();
    expect(mocks.isTokenConfigured).toHaveBeenCalledOnce();
    expect(mocks.isLocked).toHaveBeenCalledOnce();
    expect(mocks.hasAnyUser).toHaveBeenCalledOnce();
  });

  it("does not inspect users once the setup lock is present", async () => {
    mocks.isLocked.mockResolvedValue(true);
    const { getAuthSetupAvailability } = await import(
      "@/lib/auth/setup-route-guard"
    );

    await expect(getAuthSetupAvailability()).resolves.toBe("locked");
    expect(mocks.hasAnyUser).not.toHaveBeenCalled();
  });

  it("fails closed when user existence is unknown", async () => {
    mocks.hasAnyUser.mockReturnValue("unknown");
    const { getAuthSetupAvailability } = await import(
      "@/lib/auth/setup-route-guard"
    );

    await expect(getAuthSetupAvailability()).resolves.toBe("state_unknown");
  });
});
