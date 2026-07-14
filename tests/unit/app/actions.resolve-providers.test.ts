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

import {
  fetchCallHeaders,
  headerRecord,
  installFetchMock,
  mockFetchResponse,
} from "../helpers/fetch";

describe("resolveRepoProvidersAction", () => {
  const fetchBackup = global.fetch;

  beforeEach(() => {
    vi.resetModules();
    installFetchMock();
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

    vi.mocked(global.fetch)
      .mockResolvedValueOnce(mockFetchResponse({ status: 200 }))
      .mockResolvedValueOnce(
        mockFetchResponse({
          status: 404,
          statusText: "Not Found",
        }),
      )
      .mockResolvedValueOnce(
        mockFetchResponse({
          status: 404,
          statusText: "Not Found",
        }),
      );

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

    vi.mocked(global.fetch)
      .mockResolvedValueOnce(mockFetchResponse({ status: 200 }))
      .mockResolvedValueOnce(mockFetchResponse({ status: 200 }))
      .mockResolvedValueOnce(mockFetchResponse({ status: 200 }));

    const res = await actions.resolveRepoProvidersAction("owner/repo");
    expect(res.success).toBe(true);
    expect(res.candidates.map((c) => c.provider).sort()).toEqual([
      "codeberg",
      "github",
      "gitlab",
    ]);
  });

  it("resolves multiple shorthand inputs in one action call", async () => {
    const actions = await import("@/app/actions");
    vi.mocked(global.fetch).mockResolvedValue(
      mockFetchResponse({ status: 200 }),
    );

    const result = await actions.resolveRepoProvidersBatchAction([
      "owner/one",
      "owner/two",
      "owner/one",
    ]);

    expect(result.success).toBe(true);
    expect(result.resolutions.map((resolution) => resolution.input)).toEqual([
      "owner/one",
      "owner/two",
    ]);
    expect(
      result.resolutions.every(
        (resolution) => resolution.candidates.length === 3,
      ),
    ).toBe(true);
    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(6);
  });

  it("rejects oversized provider resolution batches before any lookup", async () => {
    const { MAX_PROVIDER_RESOLUTION_BATCH_SIZE } = await import(
      "@/lib/repositories/provider-resolution"
    );
    const actions = await import("@/app/actions");
    const inputs = Array.from(
      { length: MAX_PROVIDER_RESOLUTION_BATCH_SIZE + 1 },
      (_, index) => `owner/repo-${index}`,
    );

    await expect(
      actions.resolveRepoProvidersBatchAction(inputs),
    ).resolves.toEqual({ success: false, resolutions: [] });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("rejects malformed batch entries before any lookup", async () => {
    const actions = await import("@/app/actions");

    await expect(
      actions.resolveRepoProvidersBatchAction([
        "owner/repo",
        123 as unknown as string,
      ]),
    ).resolves.toEqual({ success: false, resolutions: [] });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns candidates for multiple allowed GitLab hosts", async () => {
    process.env.GITLAB_ADDITIONAL_HOSTS = "gitlab.self.test";
    process.env.GITLAB_ACCESS_TOKENS =
      "gitlab.com=glpat-main,gitlab.self.test=glpat-self";
    const actions = await import("@/app/actions");

    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        mockFetchResponse({
          status: 404,
          statusText: "Not Found",
        }),
      ) // github
      .mockResolvedValueOnce(
        mockFetchResponse({
          status: 404,
          statusText: "Not Found",
        }),
      ) // codeberg
      .mockResolvedValueOnce(mockFetchResponse({ status: 200 })) // gitlab.com
      .mockResolvedValueOnce(mockFetchResponse({ status: 200 })); // gitlab.self.test

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

    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        mockFetchResponse({
          status: 404,
          statusText: "Not Found",
        }),
      ) // github
      .mockResolvedValueOnce(
        mockFetchResponse({
          status: 404,
          statusText: "Not Found",
        }),
      ) // codeberg
      .mockResolvedValueOnce(
        mockFetchResponse({
          status: 404,
          statusText: "Not Found",
        }),
      ) // gitlab.com
      .mockResolvedValueOnce(mockFetchResponse({ status: 200 })); // gitlab.self.test

    const res = await actions.resolveRepoProvidersAction("owner/repo");
    expect(res.success).toBe(true);

    const gitlabSelfCall = vi
      .mocked(global.fetch)
      .mock.calls.find((call) =>
        String(call[0]).includes("https://gitlab.self.test/api/v4/projects/"),
      );
    expect(gitlabSelfCall).toBeTruthy();
    if (!gitlabSelfCall) {
      throw new Error("Expected self-hosted GitLab lookup call");
    }
    const authorization = headerRecord(
      fetchCallHeaders(gitlabSelfCall),
    ).Authorization;
    expect(authorization.startsWith("Basic ")).toBe(true);
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
