// vitest globals enabled

// Minimal stubs; early-return path should avoid deeper dependencies
vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
  updateTag: () => {},
}));

vi.mock("@/lib/storage/repositories", () => ({
  getRepositories: async () => [],
  saveRepositories: async () => {},
}));

vi.mock("@/lib/storage/settings", () => ({
  getSettings: async () => ({ locale: "en" }),
}));

describe("checkForNewReleases with no repositories", () => {
  it("returns notificationsSent=0 and checked=0", async () => {
    const { checkForNewReleases } = await import("@/app/actions");
    const res = await checkForNewReleases({ skipCache: true });
    expect(res).toEqual({ notificationsSent: 0, checked: 0 });
  });
});
