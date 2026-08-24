import {
  buildGlobalSettingsChangeLog,
  buildRepositorySettingsChangeLog,
} from "@/lib/settings/change-detection";
import { createDefaultSettings } from "@/lib/storage/settings";

describe("repository settings change detection", () => {
  it("records display-name changes", () => {
    const changes = buildRepositorySettingsChangeLog(
      {
        id: "owner/repository",
        url: "https://github.com/owner/repository",
        displayName: "Old name",
      },
      { displayName: "New name" },
      {},
    );

    expect(changes).toContain('displayName: "Old name" -> "New name"');
  });

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

    expect(changes).toContain('tags: ["infra","media"] -> ["media","infra"]');
  });

  it("records an explicitly empty pre-release marker override", () => {
    const changes = buildRepositorySettingsChangeLog(
      {
        id: "owner/repository",
        url: "https://github.com/owner/repository",
      },
      { preReleaseSubChannels: [] },
      {},
    );

    expect(changes).toContain("preReleaseSubChannels: undefined -> []");
  });
});

describe("global notification delivery change detection", () => {
  it("records notification modes and delivery limits", () => {
    const previous = createDefaultSettings();
    const changes = buildGlobalSettingsChangeLog(previous, {
      ...previous,
      emailNotificationMode: "batch",
      appriseNotificationMode: "batch",
      notificationMaxMessagesPerRun: 0,
      notificationDeliveryConcurrency: 12,
    });

    expect(changes).toEqual(
      expect.arrayContaining([
        'emailNotificationMode: "per_release" -> "batch"',
        'appriseNotificationMode: "per_release" -> "batch"',
        "notificationMaxMessagesPerRun: 20 -> 0",
        "notificationDeliveryConcurrency: 4 -> 12",
      ]),
    );
  });
});
