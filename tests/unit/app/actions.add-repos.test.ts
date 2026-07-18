// vitest globals enabled

import type { Repository } from "@/types";

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  updateTag: () => {},
}));

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string, _vars?: Record<string, unknown>) =>
    key,
  getLocale: async () => "en",
}));

vi.mock("@/lib/releases", () => ({
  getLatestReleasesForRepos: async () => [],
}));

const mem: { repos: Repository[] } = { repos: [] };
vi.mock("@/lib/storage/repositories", () => ({
  getRepositories: async () => mem.repos,
  saveRepositories: async (list: Repository[]) => {
    mem.repos = JSON.parse(JSON.stringify(list));
  },
}));

describe("addRepositoriesAction parses and adds valid URLs", () => {
  beforeEach(() => {
    vi.resetModules();
    mem.repos = [];
  });

  it("adds only valid supported URLs", async () => {
    const { addRepositoriesAction } = await import("@/app/actions");
    const fd = new FormData();
    fd.set(
      "urls",
      "https://github.com/owner1/repo1\nhttps://gitlab.com/invalid\n  https://github.com/Owner2/Repo2  ",
    );

    const res = await addRepositoriesAction({}, fd);
    expect(res.success).toBe(true);
    expect(mem.repos.map((r) => r.id).sort()).toEqual([
      "github:owner1/repo1",
      "github:owner2/repo2",
    ]);
  });

  it("applies and normalizes selected tags to every newly added repository", async () => {
    const { addRepositoriesAction } = await import("@/app/actions");
    const fd = new FormData();
    fd.set(
      "urls",
      "https://github.com/owner1/repo1\nhttps://github.com/owner2/repo2",
    );
    fd.append("tags", " Infra ");
    fd.append("tags", "MEDIA");
    fd.append("tags", "infra");

    const result = await addRepositoriesAction({}, fd);

    expect(result.success).toBe(true);
    expect(mem.repos.map((repository) => repository.tags)).toEqual([
      ["infra", "media"],
      ["infra", "media"],
    ]);
  });
});
