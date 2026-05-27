// vitest globals enabled

vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
  revalidatePath: () => {},
  revalidateTag: () => {},
  updateTag: () => {},
}));

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
  getLocale: async () => "en",
}));

describe("getGitlabTokenCheck", () => {
  const fetchBackup = global.fetch;

  beforeEach(() => {
    vi.resetModules();
    // @ts-expect-error
    global.fetch = vi.fn();
    delete process.env.GITLAB_ACCESS_TOKENS;
    delete process.env.GITLAB_DEPLOY_TOKENS;
    delete process.env.GITLAB_ADDITIONAL_HOSTS;
  });

  afterEach(() => {
    global.fetch = fetchBackup;
  });

  it("returns limited-valid for deploy token when /user endpoint rejects basic auth", async () => {
    process.env.GITLAB_ADDITIONAL_HOSTS = "gitlab.self.test";
    process.env.GITLAB_DEPLOY_TOKENS =
      "gitlab.self.test=gitlab+deploy-token-1:gl-dpt-abc";
    const actions = await import("@/app/actions");

    // @ts-expect-error
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      headers: { get: () => null },
    });

    const result = await actions.getGitlabTokenCheck();
    expect(result).toEqual({
      status: "valid",
      username: null,
      name: null,
      diagnosticsLimited: true,
    });

    // @ts-expect-error
    const [, requestOpts] = vi.mocked(global.fetch).mock.calls[0];
    expect(requestOpts.headers.Authorization.startsWith("Basic ")).toBe(true);
  });
});
