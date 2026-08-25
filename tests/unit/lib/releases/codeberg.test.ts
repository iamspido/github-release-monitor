import {
  afterAll,
  afterEach,
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

import { fetchLatestReleaseFromCodeberg } from "@/lib/releases/codeberg";

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

describe("releases/codeberg", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeAll(() => {
    originalEnv = { ...process.env };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes Codeberg-specific arguments to the shared base", async () => {
    const locale: Locale = "en";
    const repoSettingsValue = repoSettings();

    await fetchLatestReleaseFromCodeberg(
      "Owner",
      "Repo",
      repoSettingsValue,
      globalSettings,
      locale,
    );

    expect(fetcherMocks.fetchLatestReleaseFromForgejoBase).toHaveBeenCalledWith(
      {
        baseUrl: "https://codeberg.org",
        repoId: "codeberg:owner/repo",
        providerLabel: "Codeberg",
        authToken: null,
        allowedRedirectBaseUrl: null,
        owner: "Owner",
        repo: "Repo",
        repoSettings: repoSettingsValue,
        globalSettings,
        locale,
      },
    );
  });

  it("passes a configured CODEBERG_ACCESS_TOKEN through", async () => {
    vi.stubEnv("CODEBERG_ACCESS_TOKEN", "test-token");

    await fetchLatestReleaseFromCodeberg(
      "owner",
      "repo",
      { cacheInterval: 10, releasesPerPage: 30 },
      globalSettings,
      "en",
    );

    expect(fetcherMocks.fetchLatestReleaseFromForgejoBase).toHaveBeenCalledWith(
      expect.objectContaining({ authToken: "test-token" }),
    );
  });
});
