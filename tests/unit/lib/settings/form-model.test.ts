import {
  areSettingsSnapshotsEqual,
  getSettingsReconciliationPatch,
  hasRefreshSensitiveRepoSettingChanges,
  hasSettingsSnapshotDrift,
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

  it("detects a revert that must reconcile an in-flight snapshot", () => {
    type SettingsSnapshot = {
      releasesPerPage: number;
      includeRegex?: string;
    };
    const persisted: SettingsSnapshot = {
      releasesPerPage: 30,
      includeRegex: undefined,
    };
    const submitted: SettingsSnapshot = {
      releasesPerPage: 50,
      includeRegex: "stable",
    };

    expect(hasSettingsSnapshotDrift(persisted, submitted, persisted)).toBe(
      true,
    );
    expect(hasSettingsSnapshotDrift(persisted, persisted, persisted)).toBe(
      false,
    );
    expect(
      getSettingsReconciliationPatch(persisted, submitted, persisted),
    ).toEqual({
      releasesPerPage: 30,
      includeRegex: undefined,
    });
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
