// vitest globals enabled

import type { AppSettings, Repository } from "@/types";

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  updateTag: () => {},
}));

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
  getLocale: async () => "en",
}));

const mem: { repos: Repository[] } = { repos: [] };
vi.mock("@/lib/storage/repositories", () => ({
  getRepositories: async () => mem.repos,
  saveRepositories: async (list: Repository[]) => {
    mem.repos = JSON.parse(JSON.stringify(list));
  },
}));

vi.mock("@/lib/releases", () => ({
  getLatestReleasesForRepos: async () => [],
}));

// showAcknowledge=false should normalize imported isNew to false
vi.mock("@/lib/storage/settings", () => ({
  getSettings: async () =>
    ({
      timeFormat: "24h",
      locale: "en",
      refreshInterval: 10,
      cacheInterval: 5,
      releasesPerPage: 30,
      parallelRepoFetches: 1,
      releaseChannels: ["stable"],
      showAcknowledge: false,
    }) satisfies AppSettings,
}));

describe("importRepositoriesAction normalization with showAcknowledge=false", () => {
  beforeEach(() => {
    vi.resetModules();
    mem.repos = [];
  });

  it("forces isNew=false on imported data", async () => {
    const { importRepositoriesAction } = await import("@/app/actions");
    const imported: Repository[] = [
      { id: "o/r", url: "https://github.com/o/r", isNew: true },
    ];
    const res = await importRepositoriesAction(imported);
    const { waitForBackgroundTasks } = await import(
      "@/lib/runtime/background-tasks"
    );
    await waitForBackgroundTasks();

    expect(res.success).toBe(true);
    expect(mem.repos[0].isNew).toBe(false);
  });
});
