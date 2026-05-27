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

describe("addRepositoriesAction only invalid inputs", () => {
  beforeEach(() => {
    vi.resetModules();
    mem.repos = [];
  });

  it("returns error when all inputs are invalid and no additions are possible", async () => {
    const { addRepositoriesAction } = await import("@/app/actions");
    const fd = new FormData();
    fd.set(
      "urls",
      ["https://example.com/not-github/abc", "not a url", "   "].join("\n"),
    );

    const res = await addRepositoriesAction({}, fd);
    expect(res.success).toBe(false);
    expect(res.error).toBe("toast_fail_description_manual");
    expect(res).not.toHaveProperty("jobId");
    expect(mem.repos.length).toBe(0);
  });
});
