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
});
