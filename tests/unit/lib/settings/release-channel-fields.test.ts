import { describe, expect, it } from "vitest";
import {
  getAllPreReleaseSubChannels,
  shouldSelectAllPreReleaseSubChannels,
  togglePreReleaseSubChannel,
  toggleReleaseChannel,
} from "@/lib/settings/release-channel-fields";
import { allPreReleaseTypes } from "@/types";

describe("settings/release-channel-fields", () => {
  it("adds and removes release channels without mutating the input", () => {
    const original = ["stable"] as const;

    expect(toggleReleaseChannel([...original], "prerelease")).toEqual([
      "stable",
      "prerelease",
    ]);
    expect(toggleReleaseChannel(["stable", "draft"], "stable")).toEqual([
      "draft",
    ]);
    expect(original).toEqual(["stable"]);
  });

  it("adds and removes prerelease subchannels", () => {
    expect(togglePreReleaseSubChannel(["alpha"], "beta")).toEqual([
      "alpha",
      "beta",
    ]);
    expect(togglePreReleaseSubChannel(["alpha", "rc"], "alpha")).toEqual([
      "rc",
    ]);
  });

  it("selects all subchannels only when prereleases are being enabled", () => {
    expect(
      shouldSelectAllPreReleaseSubChannels("prerelease", [
        "stable",
        "prerelease",
      ]),
    ).toBe(true);
    expect(shouldSelectAllPreReleaseSubChannels("prerelease", ["stable"])).toBe(
      false,
    );
    expect(
      shouldSelectAllPreReleaseSubChannels("stable", ["stable", "prerelease"]),
    ).toBe(false);
  });

  it("exposes every supported prerelease subchannel", () => {
    expect(getAllPreReleaseSubChannels()).toEqual(allPreReleaseTypes);
  });
});
