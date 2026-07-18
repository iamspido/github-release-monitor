import { buildRepositorySettingsChangeLog } from "@/lib/settings/change-detection";

describe("repository settings change detection", () => {
  it("records repository tag order changes", () => {
    const changes = buildRepositorySettingsChangeLog(
      {
        id: "owner/repository",
        url: "https://github.com/owner/repository",
        tags: ["infra", "media"],
      },
      { tags: ["media", "infra"] },
      {},
    );

    expect(changes).toContain(
      'tags: ["infra","media"] -> ["media","infra"]',
    );
  });
});
