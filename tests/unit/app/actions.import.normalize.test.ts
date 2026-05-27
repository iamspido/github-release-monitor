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

const mem: { repos: Repository[] } = { repos: [] };
vi.mock("@/lib/storage/repositories", () => ({
  getRepositories: async () => mem.repos,
  saveRepositories: async (list: Repository[]) => {
    mem.repos = JSON.parse(JSON.stringify(list));
  },
}));

// showAcknowledge=false should normalize imported isNew to false
vi.mock("@/lib/storage/settings", () => ({
  getSettings: async () => ({ showAcknowledge: false, locale: "en" }),
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
    expect(res.success).toBe(true);
    expect(mem.repos[0].isNew).toBe(false);
  });
});
