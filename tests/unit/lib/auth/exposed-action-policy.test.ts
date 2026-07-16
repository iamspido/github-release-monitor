// vitest globals enabled

const mocks = vi.hoisted(() => ({
  canPerformRestrictedAction: vi.fn(),
  getLocale: vi.fn(),
  getTranslations: vi.fn(),
}));

vi.mock("@/lib/auth/access", () => ({
  canPerformRestrictedAction: mocks.canPerformRestrictedAction,
}));

vi.mock("next-intl/server", () => ({
  getLocale: mocks.getLocale,
  getTranslations: mocks.getTranslations,
}));

describe("exposed action policy", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.canPerformRestrictedAction.mockReset();
    mocks.getLocale.mockResolvedValue("en");
    mocks.getTranslations.mockResolvedValue((key: string) => key);
  });

  it("runs an allowed restricted action", async () => {
    mocks.canPerformRestrictedAction.mockResolvedValue(true);
    const action = vi.fn().mockResolvedValue("result");
    const { runExposedRestrictedActionWithFallback } = await import(
      "@/lib/auth/exposed-action-policy"
    );

    await expect(
      runExposedRestrictedActionWithFallback(action, "fallback"),
    ).resolves.toBe("result");
    expect(action).toHaveBeenCalledOnce();
  });

  it("returns a lazy fallback without invoking a denied action", async () => {
    mocks.canPerformRestrictedAction.mockResolvedValue(false);
    const action = vi.fn().mockResolvedValue("result");
    const fallback = vi.fn().mockResolvedValue("fallback");
    const { runExposedRestrictedActionWithFallback } = await import(
      "@/lib/auth/exposed-action-policy"
    );

    await expect(
      runExposedRestrictedActionWithFallback(action, fallback),
    ).resolves.toBe("fallback");
    expect(action).not.toHaveBeenCalled();
    expect(fallback).toHaveBeenCalledOnce();
  });

  it("throws the localized authentication error for a denied strict action", async () => {
    mocks.canPerformRestrictedAction.mockResolvedValue(false);
    const action = vi.fn().mockResolvedValue("result");
    const { runExposedRestrictedActionOrThrow } = await import(
      "@/lib/auth/exposed-action-policy"
    );

    await expect(runExposedRestrictedActionOrThrow(action)).rejects.toThrow(
      "error_auth_required",
    );
    expect(action).not.toHaveBeenCalled();
    expect(mocks.getTranslations).toHaveBeenCalledWith({
      locale: "en",
      namespace: "Actions",
    });
  });
});
