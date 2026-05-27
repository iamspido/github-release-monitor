// vitest globals enabled

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
  updateTag: () => {},
}));

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
  getLocale: async () => "en",
}));

describe("resolveRepoProvidersAction", () => {
  const fetchBackup = global.fetch;

  beforeEach(() => {
    vi.resetModules();
    // @ts-expect-error
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = fetchBackup;
    delete process.env.GITHUB_ACCESS_TOKEN;
    delete process.env.CODEBERG_ACCESS_TOKEN;
    delete process.env.GITLAB_ACCESS_TOKENS;
    delete process.env.GITLAB_DEPLOY_TOKENS;
    delete process.env.GITLAB_ADDITIONAL_HOSTS;
  });

  it("returns only the provider that exists", async () => {
    const actions = await import("@/app/actions");

    // @ts-expect-error
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({ ok: true, status: 200, statusText: "OK" })
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
      });

    const res = await actions.resolveRepoProvidersAction("owner/repo");
    expect(res.success).toBe(true);
    expect(res.candidates).toEqual([
      {
        provider: "github",
        id: "github:owner/repo",
        canonicalRepoUrl: "https://github.com/owner/repo",
      },
    ]);
  });

  it("returns multiple candidates when they all exist", async () => {
    const actions = await import("@/app/actions");

    // @ts-expect-error
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({ ok: true, status: 200, statusText: "OK" })
      .mockResolvedValueOnce({ ok: true, status: 200, statusText: "OK" })
      .mockResolvedValueOnce({ ok: true, status: 200, statusText: "OK" });

    const res = await actions.resolveRepoProvidersAction("owner/repo");
    expect(res.success).toBe(true);
    expect(res.candidates.map((c) => c.provider).sort()).toEqual([
      "codeberg",
      "github",
      "gitlab",
    ]);
  });

  it("returns candidates for multiple allowed GitLab hosts", async () => {
    process.env.GITLAB_ADDITIONAL_HOSTS = "gitlab.self.test";
    process.env.GITLAB_ACCESS_TOKENS =
      "gitlab.com=glpat-main,gitlab.self.test=glpat-self";
    const actions = await import("@/app/actions");

    // @ts-expect-error
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
      }) // github
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
      }) // codeberg
      .mockResolvedValueOnce({ ok: true, status: 200, statusText: "OK" }) // gitlab.com
      .mockResolvedValueOnce({ ok: true, status: 200, statusText: "OK" }); // gitlab.self.test

    const res = await actions.resolveRepoProvidersAction("owner/repo");
    expect(res.success).toBe(true);
    expect(res.candidates.filter((c) => c.provider === "gitlab")).toEqual([
      {
        provider: "gitlab",
        providerHost: "gitlab.com",
        id: "gitlab:gitlab.com/owner/repo",
        canonicalRepoUrl: "https://gitlab.com/owner/repo",
      },
      {
        provider: "gitlab",
        providerHost: "gitlab.self.test",
        id: "gitlab:gitlab.self.test/owner/repo",
        canonicalRepoUrl: "https://gitlab.self.test/owner/repo",
      },
    ]);
  });

  it("uses basic auth for GitLab lookup when only deploy token is configured", async () => {
    process.env.GITLAB_ADDITIONAL_HOSTS = "gitlab.self.test";
    process.env.GITLAB_DEPLOY_TOKENS =
      "gitlab.self.test=gitlab+deploy-token-1:gl-dpt-abc";
    const actions = await import("@/app/actions");

    // @ts-expect-error
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
      }) // github
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
      }) // codeberg
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
      }) // gitlab.com
      .mockResolvedValueOnce({ ok: true, status: 200, statusText: "OK" }); // gitlab.self.test

    const res = await actions.resolveRepoProvidersAction("owner/repo");
    expect(res.success).toBe(true);

    // @ts-expect-error
    const gitlabSelfCall = vi
      .mocked(global.fetch)
      .mock.calls.find((call) =>
        String(call[0]).includes("https://gitlab.self.test/api/v4/projects/"),
      );
    expect(gitlabSelfCall).toBeTruthy();
    expect(gitlabSelfCall[1].headers.Authorization.startsWith("Basic ")).toBe(
      true,
    );
  });

  it("does nothing for non-shorthand inputs", async () => {
    const actions = await import("@/app/actions");

    const res = await actions.resolveRepoProvidersAction(
      "https://github.com/owner/repo",
    );
    expect(res.success).toBe(true);
    expect(res.candidates).toEqual([]);
    expect(vi.mocked(global.fetch).mock.calls.length).toBe(0);
  });
});
