import { parseComparableVersion } from "@/lib/releases/version";

describe("releases/version", () => {
  it("parses unprefixed and prefixed semantic versions into families", () => {
    expect(parseComparableVersion("v1.2.3")).toEqual({
      core: [BigInt(1), BigInt(2), BigInt(3)],
      prerelease: [],
      family: "",
      revision: BigInt(-1),
    });
    expect(parseComparableVersion("runtime-1.26.5")).toEqual({
      core: [BigInt(1), BigInt(26), BigInt(5)],
      prerelease: [],
      family: "runtime",
      revision: BigInt(-1),
    });
    expect(parseComparableVersion("release.r60.3")).toEqual({
      core: [BigInt(60), BigInt(3)],
      prerelease: [],
      family: "release.r",
      revision: BigInt(-1),
    });
    expect(parseComparableVersion("release-v2")).toEqual({
      core: [BigInt(2)],
      prerelease: [],
      family: "release",
      revision: BigInt(-1),
    });
  });

  it("supports embedded product digits when the version boundary is safe", () => {
    expect(parseComparableVersion("product3-2.10.1")).toEqual({
      core: [BigInt(2), BigInt(10), BigInt(1)],
      prerelease: [],
      family: "product3",
      revision: BigInt(-1),
    });
    expect(parseComparableVersion("api2-v1.4.0")).toEqual({
      core: [BigInt(1), BigInt(4), BigInt(0)],
      prerelease: [],
      family: "api2",
      revision: BigInt(-1),
    });
  });

  it("keeps prefixed calendar versions comparable", () => {
    expect(parseComparableVersion("release-2026.07.26")).toEqual({
      core: [BigInt(2026), BigInt(7), BigInt(26)],
      prerelease: [],
      family: "release",
      revision: BigInt(-1),
    });
    expect(parseComparableVersion("product/2026.7.1")).toEqual({
      core: [BigInt(2026), BigInt(7), BigInt(1)],
      prerelease: [],
      family: "product",
      revision: BigInt(-1),
    });
  });

  it("parses compact prereleases using the configured channel identifiers", () => {
    expect(parseComparableVersion("runtime1.27b10")).toEqual({
      core: [BigInt(1), BigInt(27)],
      prerelease: ["b", BigInt(10)],
      family: "runtime",
      revision: BigInt(-1),
    });
  });

  it("separates stable package revisions from semantic prereleases", () => {
    expect(parseComparableVersion("docker/5.0.0-r10")).toEqual({
      core: [BigInt(5), BigInt(0), BigInt(0)],
      prerelease: [],
      family: "docker",
      revision: BigInt(10),
    });
    expect(parseComparableVersion("docker/5.0.0-experimental.1-r2")).toEqual({
      core: [BigInt(5), BigInt(0), BigInt(0)],
      prerelease: ["experimental", BigInt(1)],
      family: "docker",
      revision: BigInt(2),
    });
  });

  it.each([
    "weekly.2012-03-27",
    "weekly.2012-03.27",
    "1.2.3.4.5",
    "9.8.7.6.5",
    "-1.2.3",
    "_1.2.3",
  ])("rejects numeric backtracking in %s", (tagName) => {
    expect(parseComparableVersion(tagName)).toBeNull();
  });

  it.each([
    "weekly-2012.03.27",
    "nightly2026.07.26",
    "build/2026.07.26",
    "snapshot-2024.2.29rc1",
  ])("rejects prefixed calendar dates in %s", (tagName) => {
    expect(parseComparableVersion(tagName)).toBeNull();
  });
});
