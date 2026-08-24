import { prepareSettingsUpdate } from "@/lib/settings/update-command";
import { createDefaultSettings } from "@/lib/storage/settings";

describe("settings update command", () => {
  it("normalizes a patch and reports repository side effects", () => {
    const current = createDefaultSettings({ GITHUB_ACCESS_TOKEN: "token" });
    const result = prepareSettingsUpdate(
      {
        showAcknowledge: false,
        includeRegex: "  ^v  ",
        parallelRepoFetches: 50,
        notificationMaxMessagesPerRun: 0,
        notificationDeliveryConcurrency: 50,
      },
      current,
      true,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.settingsToSave).toEqual(
      expect.objectContaining({
        showAcknowledge: false,
        includeRegex: "^v",
        parallelRepoFetches: 50,
        notificationMaxMessagesPerRun: 0,
        notificationDeliveryConcurrency: 50,
      }),
    );
    expect(result.value.shouldResetNewFlags).toBe(true);
    expect(result.value.shouldClearEtags).toBe(true);
  });

  it("returns validation keys without producing a persistence command", () => {
    const current = createDefaultSettings();

    expect(prepareSettingsUpdate({ includeRegex: "[" }, current, true)).toEqual(
      {
        ok: false,
        errorKey: "regex_error_invalid",
        locale: "en",
      },
    );
    expect(
      prepareSettingsUpdate(
        { backgroundCheckCron: "not a cron" },
        current,
        true,
      ),
    ).toEqual({
      ok: false,
      errorKey: "cron_error_invalid",
      locale: "en",
    });
    expect(
      prepareSettingsUpdate({ customPreReleaseMarkers: ["."] }, current, true),
    ).toEqual({
      ok: false,
      errorKey: "custom_prerelease_markers_error_invalid",
      locale: "en",
      errorValues: ["."],
    });
  });
});
