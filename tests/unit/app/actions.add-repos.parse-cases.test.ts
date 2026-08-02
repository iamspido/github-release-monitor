// vitest globals enabled

import type { Repository } from "@/types";

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  updateTag: () => {},
}));

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
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

describe("addRepositoriesAction parsing cases", () => {
  beforeEach(() => {
    vi.resetModules();
    mem.repos = [];
    delete process.env.FORGEJO_ADDITIONAL_BASE_URLS;
  });

  afterEach(() => {
    delete process.env.FORGEJO_ADDITIONAL_BASE_URLS;
  });

  it("parses owner/repo with dots and underscores and ignores blank/invalid lines", async () => {
    const { addRepositoriesAction } = await import("@/app/actions");
    const fd = new FormData();
    fd.set(
      "urls",
      [
        "  ",
        "https://github.com/Owner.Name/My_Repo",
        "",
        "https://github.com/owner-name/re.po",
        "https://example.test/not-valid",
        "https://github.com/owner---/r_e.p.o",
      ].join("\n"),
    );

    const res = await addRepositoriesAction({}, fd);
    expect(res.success).toBe(true);
    // All valid parsed, normalized to lowercase
    const ids = mem.repos.map((r) => r.id).sort();
    expect(ids).toEqual([
      "github:owner---/r_e.p.o",
      "github:owner-name/re.po",
      "github:owner.name/my_repo",
    ]);
  });

  it("adds a repository from a configured Forgejo subpath", async () => {
    process.env.FORGEJO_ADDITIONAL_BASE_URLS = "https://scm.example.test/code";
    const { addRepositoriesAction } = await import("@/app/actions");
    const fd = new FormData();
    fd.set("urls", "https://scm.example.test/code/Owner/Repo.git");

    const res = await addRepositoriesAction({}, fd);

    expect(res.success).toBe(true);
    expect(mem.repos).toEqual([
      {
        id: "forgejo:scm.example.test/code/owner/repo",
        url: "https://scm.example.test/code/Owner/Repo",
      },
    ]);
  });
});
