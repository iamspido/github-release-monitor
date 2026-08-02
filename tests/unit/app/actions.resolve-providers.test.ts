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
    delete process.env.FORGEJO_ADDITIONAL_BASE_URLS;
    delete process.env.FORGEJO_ACCESS_TOKENS;
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

  it("returns an allowed Forgejo subpath candidate with its base URL", async () => {
    process.env.FORGEJO_ADDITIONAL_BASE_URLS =
      "http://forgejo.internal.test:3000/code";
    process.env.FORGEJO_ACCESS_TOKENS =
      "http://forgejo.internal.test:3000/code=forgejo-token";
    const actions = await import("@/app/actions");
    vi.mocked(global.fetch).mockImplementation(async (input) => {
      const isForgejo = String(input).startsWith(
        "http://forgejo.internal.test:3000/code/",
      );
      return mockFetchResponse(
        isForgejo
          ? {
              status: 200,
              json: {
                name: "repo",
                full_name: "owner/repo",
                owner: { login: "owner" },
              },
            }
          : { status: 404 },
      );
    });

    const result = await actions.resolveRepoProvidersAction("owner/repo");

    expect(result.candidates).toContainEqual({
      provider: "forgejo",
      providerHost: "forgejo.internal.test:3000",
      providerBaseUrl: "http://forgejo.internal.test:3000/code",
      id: "forgejo:forgejo.internal.test:3000/code/owner/repo",
      canonicalRepoUrl: "http://forgejo.internal.test:3000/code/owner/repo",
    });
    const forgejoCall = vi
      .mocked(global.fetch)
      .mock.calls.find((call) =>
        String(call[0]).startsWith("http://forgejo.internal.test:3000/code/"),
      );
    expect(forgejoCall).toBeTruthy();
    if (!forgejoCall) {
      throw new Error("Expected Forgejo lookup call");
    }
    expect(String(forgejoCall[0])).toBe(
      "http://forgejo.internal.test:3000/code/api/v1/repos/owner/repo",
    );
    expect(headerRecord(fetchCallHeaders(forgejoCall)).Authorization).toBe(
      "token forgejo-token",
    );
    expect(forgejoCall[1]).toMatchObject({ redirect: "manual" });
  });

  it("checks multiple Forgejo instances with bounded parallelism", async () => {
    const forgejoBaseUrls = Array.from(
      { length: 6 },
      (_, index) => `https://forgejo-${index + 1}.example.test/code`,
    );
    process.env.FORGEJO_ADDITIONAL_BASE_URLS = forgejoBaseUrls.join(",");
    const actions = await import("@/app/actions");
    let activeForgejoRequests = 0;
    let maxActiveForgejoRequests = 0;

    vi.mocked(global.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (!url.includes(".example.test/code/api/v1/repos/owner/repo")) {
        return mockFetchResponse({ status: 404 });
      }

      activeForgejoRequests += 1;
      maxActiveForgejoRequests = Math.max(
        maxActiveForgejoRequests,
        activeForgejoRequests,
      );
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeForgejoRequests -= 1;
      return mockFetchResponse({
        status: 200,
        json: {
          name: "repo",
          full_name: "owner/repo",
          owner: { login: "owner" },
        },
      });
    });

    const result = await actions.resolveRepoProvidersAction("owner/repo");

    expect(result.candidates).toHaveLength(6);
    expect(
      result.candidates.map((candidate) => candidate.providerBaseUrl),
    ).toEqual(forgejoBaseUrls);
    expect(maxActiveForgejoRequests).toBeGreaterThan(1);
    expect(maxActiveForgejoRequests).toBeLessThanOrEqual(4);
  });

  it("ignores successful Forgejo responses that are not repository payloads", async () => {
    process.env.FORGEJO_ADDITIONAL_BASE_URLS =
      "https://forgejo.example.test/code";
    const actions = await import("@/app/actions");
    vi.mocked(global.fetch).mockImplementation(async (input) =>
      String(input).startsWith("https://forgejo.example.test/code/")
        ? mockFetchResponse({ status: 200, text: "<html>Sign in</html>" })
        : mockFetchResponse({ status: 404 }),
    );

    const result = await actions.resolveRepoProvidersAction("owner/repo");

    expect(result.candidates).toEqual([]);
  });
});
