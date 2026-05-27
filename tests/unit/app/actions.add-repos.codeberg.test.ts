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

describe("addRepositoriesAction accepts Codeberg URLs", () => {
  beforeEach(() => {
    vi.resetModules();
    mem.repos = [];
    delete process.env.GITLAB_ADDITIONAL_HOSTS;
  });

  it("parses codeberg.org owner/repo and prefixes id", async () => {
    const { addRepositoriesAction } = await import("@/app/actions");
    const fd = new FormData();
    fd.set(
      "urls",
      [
        "https://github.com/owner/repo",
        "https://codeberg.org/Owner/Repo.git",
        "https://codeberg.org/other/repo2",
      ].join("\n"),
    );

    const res = await addRepositoriesAction({}, fd);
    expect(res.success).toBe(true);
    const ids = mem.repos.map((r) => r.id).sort();
    expect(ids).toEqual([
      "codeberg:other/repo2",
      "codeberg:owner/repo",
      "github:owner/repo",
    ]);
    const codeberg = mem.repos.find((r) => r.id === "codeberg:owner/repo");
    expect(codeberg.url).toBe("https://codeberg.org/Owner/Repo");
  });

  it("parses gitlab.com group paths and prefixes id", async () => {
    const { addRepositoriesAction } = await import("@/app/actions");
    const fd = new FormData();
    fd.set(
      "urls",
      [
        "https://gitlab.com/group/subgroup/repo",
        "https://gitlab.com/solo/repo/-/releases",
      ].join("\n"),
    );

    const res = await addRepositoriesAction({}, fd);
    expect(res.success).toBe(true);
    const ids = mem.repos.map((r) => r.id).sort();
    expect(ids).toEqual([
      "gitlab:gitlab.com/group/subgroup/repo",
      "gitlab:gitlab.com/solo/repo",
    ]);
    const gitlab = mem.repos.find(
      (r) => r.id === "gitlab:gitlab.com/group/subgroup/repo",
    );
    expect(gitlab.url).toBe("https://gitlab.com/group/subgroup/repo");
  });

  it("parses additional self-hosted gitlab domains from env", async () => {
    process.env.GITLAB_ADDITIONAL_HOSTS = "gitlab.self.test";
    const { addRepositoriesAction } = await import("@/app/actions");
    const fd = new FormData();
    fd.set(
      "urls",
      ["https://gitlab.self.test/t.hohmann/tagesmutter-hohmann"].join("\n"),
    );

    const res = await addRepositoriesAction({}, fd);
    expect(res.success).toBe(true);
    expect(mem.repos.map((r) => r.id)).toEqual([
      "gitlab:gitlab.self.test/t.hohmann/tagesmutter-hohmann",
    ]);
  });

  it("rejects non-allowed self-hosted gitlab domains", async () => {
    const { addRepositoriesAction } = await import("@/app/actions");
    const fd = new FormData();
    fd.set("urls", "https://gitlab.self.test/t.hohmann/tagesmutter-hohmann");

    const res = await addRepositoriesAction({}, fd);
    expect(res.success).toBe(false);
    expect(mem.repos).toEqual([]);
  });
});
