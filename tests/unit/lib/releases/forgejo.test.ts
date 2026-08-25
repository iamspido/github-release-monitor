import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { RepoSettingsForFetch } from "@/lib/releases/types";
import type { AppSettings, Locale } from "@/types";

const fetcherMocks = vi.hoisted(() => ({
  fetchLatestReleaseFromForgejoBase: vi.fn(),
}));

vi.mock("@/lib/releases/forgejo-base", () => ({
  fetchLatestReleaseFromForgejoBase:
    fetcherMocks.fetchLatestReleaseFromForgejoBase,
}));

import { fetchLatestReleaseFromForgejo } from "@/lib/releases/forgejo";

const globalSettings: AppSettings = {
  timeFormat: "24h",
  locale: "en",
  refreshInterval: 10,
  cacheInterval: 5,
  releasesPerPage: 30,
  parallelRepoFetches: 1,
  releaseChannels: ["stable"],
};

function repoSettings(): RepoSettingsForFetch {
  return { cacheInterval: 10, releasesPerPage: 30 };
}

describe("releases/forgejo", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeAll(() => {
    originalEnv = { ...process.env };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes Forgejo-specific arguments to the shared base", async () => {
    const locale: Locale = "en";
    const repoSettingsValue = repoSettings();
    process.env.FORGEJO_ADDITIONAL_BASE_URLS =
      "http://forgejo.internal.test:3000";

    await fetchLatestReleaseFromForgejo(
      "http://forgejo.internal.test:3000",
      "Owner",
      "Repo",
      repoSettingsValue,
      globalSettings,
      locale,
    );

    expect(fetcherMocks.fetchLatestReleaseFromForgejoBase).toHaveBeenCalledWith(
      {
        baseUrl: "http://forgejo.internal.test:3000",
        repoId: "forgejo:forgejo.internal.test:3000/owner/repo",
        providerLabel: "Forgejo",
        authToken: null,
        allowedRedirectBaseUrl: "http://forgejo.internal.test:3000",
        owner: "Owner",
        repo: "Repo",
        repoSettings: repoSettingsValue,
        globalSettings,
        locale,
      },
    );
  });

  it("returns invalid_url when the base URL is not allowed", async () => {
    const result = await fetchLatestReleaseFromForgejo(
      "https://not-allowed.example",
      "owner",
      "repo",
      repoSettings(),
      globalSettings,
      "en",
    );

    expect(result.release).toBeNull();
    expect(result.error).toEqual({ type: "invalid_url" });
    expect(
      fetcherMocks.fetchLatestReleaseFromForgejoBase,
    ).not.toHaveBeenCalled();
  });

  it("passes a configured FORGEJO_ACCESS_TOKENS entry through", async () => {
    process.env.FORGEJO_ADDITIONAL_BASE_URLS =
      "http://forgejo.internal.test:3000";
    process.env.FORGEJO_ACCESS_TOKENS =
      "http://forgejo.internal.test:3000=forgejo-token";

    await fetchLatestReleaseFromForgejo(
      "http://forgejo.internal.test:3000",
      "owner",
      "repo",
      { cacheInterval: 10, releasesPerPage: 30 },
      globalSettings,
      "en",
    );

    expect(fetcherMocks.fetchLatestReleaseFromForgejoBase).toHaveBeenCalledWith(
      expect.objectContaining({
        authToken: "forgejo-token",
        repoId: "forgejo:forgejo.internal.test:3000/owner/repo",
      }),
    );
  });
});
