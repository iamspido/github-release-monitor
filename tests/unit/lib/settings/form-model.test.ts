import {
  areSettingsSnapshotsEqual,
  getSettingsReconciliationPatch,
  hasRefreshSensitiveRepoSettingChanges,
  hasSettingsSnapshotDrift,
  parseCustomPreReleaseMarkers,
  type RefreshSensitiveRepoSettings,
  validateCustomPreReleaseMarkersInput,
  validateOptionalIntegerInput,
  validateRegexInput,
} from "@/lib/settings/form-model";

describe("settings/form-model", () => {
  it("validates optional regex inputs", () => {
    expect(validateRegexInput("")).toBeNull();
    expect(validateRegexInput(" v\\d+ ")).toBeNull();
    expect(validateRegexInput("[broken")).toBe("invalid");
  });

  it("accepts only complete integer inputs", () => {
    expect(validateOptionalIntegerInput("0", 0, 10_000)).toBeNull();
    expect(validateOptionalIntegerInput("50", 1, 50)).toBeNull();
    expect(validateOptionalIntegerInput("1.9", 0, 10_000)).toBe("invalid");
    expect(validateOptionalIntegerInput("1e2", 0, 10_000)).toBeNull();
    expect(validateOptionalIntegerInput("value", 0, 10_000)).toBe("invalid");
    expect(validateOptionalIntegerInput("-1", 0, 10_000)).toBe("too_low");
    expect(validateOptionalIntegerInput("10001", 0, 10_000)).toBe("too_high");
  });

  it("normalizes comma-separated custom pre-release markers", () => {
    expect(
      parseCustomPreReleaseMarkers(" Experimental, testing,EXPERIMENTAL,  "),
    ).toEqual(["experimental", "testing"]);
    expect(parseCustomPreReleaseMarkers("تجريبي، اختبار，حافة")).toEqual([
      "تجريبي",
      "اختبار",
      "حافة",
    ]);
  });

  it("validates identifier-like custom pre-release markers", () => {
    expect(
      validateCustomPreReleaseMarkersInput(
        "experimental, test-edge, тестовый, 测试",
      ),
    ).toEqual([]);
    expect(
      validateCustomPreReleaseMarkersInput("., _dev, 2beta, Edge3, test-2"),
    ).toEqual([".", "_dev", "2beta", "Edge3", "test-2"]);
  });

  it("keeps Unicode marker validation stable after normalization", () => {
    expect(validateCustomPreReleaseMarkersInput("İtest")).toEqual([]);
    const normalized = parseCustomPreReleaseMarkers("İtest");
    expect(normalized).toEqual(["i\u0307test"]);
    expect(validateCustomPreReleaseMarkersInput(normalized[0])).toEqual([]);
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
      customPreReleaseMarkers: ["testing"],
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
        customPreReleaseMarkers: [],
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
