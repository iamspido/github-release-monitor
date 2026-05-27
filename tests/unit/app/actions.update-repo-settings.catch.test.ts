// vitest globals enabled

import type { Repository } from "@/types";

const { cacheMocks } = vi.hoisted(() => ({
  cacheMocks: {
    revalidatePath: vi.fn(),
    updateTag: vi.fn(),
  },
}));

vi.mock("next/cache", () => cacheMocks);

vi.mock("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async () => (key: string) => key,
}));

const mem: { repos: Repository[] } = { repos: [] };
const storage = {
  getRepositories: async () => mem.repos,
  saveRepositories: async (list: Repository[]) => {
    mem.repos = JSON.parse(JSON.stringify(list));
  },
};

vi.mock("@/lib/storage/repositories", () => storage);

describe("updateRepositorySettingsAction catch path", () => {
  beforeEach(() => {
    vi.resetModules();
    mem.repos = [];
    cacheMocks.revalidatePath.mockReset?.();
  });

  it("returns error message when saveRepositories throws", async () => {
    mem.repos = [
      { id: "o/r", url: "https://github.com/o/r", releasesPerPage: 30 },
    ];

    // Patch saveRepositories to throw for this test
    const saveSpy = vi
      .spyOn(storage, "saveRepositories")
      .mockRejectedValueOnce(new Error("fail-save"));

    const { updateRepositorySettingsAction } = await import("@/app/actions");
    const res = await updateRepositorySettingsAction("o/r", {
      releasesPerPage: 50,
    });
    expect(res.success).toBe(false);
    expect(res.error).toBe("fail-save");

    saveSpy.mockRestore();
  });
});
