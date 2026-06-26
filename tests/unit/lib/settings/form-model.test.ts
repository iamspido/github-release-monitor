import {
  areSettingsSnapshotsEqual,
  hasRefreshSensitiveRepoSettingChanges,
  type RefreshSensitiveRepoSettings,
  validateRegexInput,
} from "@/lib/settings/form-model";

describe("settings/form-model", () => {
  it("validates optional regex inputs", () => {
    expect(validateRegexInput("")).toBeNull();
    expect(validateRegexInput(" v\\d+ ")).toBeNull();
    expect(validateRegexInput("[broken")).toBe("invalid");
  });

  it("compares persisted settings snapshots", () => {
    expect(areSettingsSnapshotsEqual({ a: 1 }, { a: 1 })).toBe(true);
    expect(areSettingsSnapshotsEqual({ a: 1 }, { a: 2 })).toBe(false);
  });

  it("detects only refresh-sensitive repository setting changes", () => {
    const base: RefreshSensitiveRepoSettings = {
      releaseChannels: ["stable", "prerelease"],
      preReleaseSubChannels: ["beta"],
      releasesPerPage: 20,
      includeRegex: "v",
      excludeRegex: "nightly",
    };

    expect(
      hasRefreshSensitiveRepoSettingChanges(base, {
        ...base,
        releaseChannels: ["prerelease", "stable"],
      }),
    ).toBe(false);
    expect(
      hasRefreshSensitiveRepoSettingChanges(base, {
        ...base,
        includeRegex: "stable",
      }),
    ).toBe(true);
    expect(
      hasRefreshSensitiveRepoSettingChanges(base, {
        ...base,
        releasesPerPage: 50,
      }),
    ).toBe(true);
  });
});
