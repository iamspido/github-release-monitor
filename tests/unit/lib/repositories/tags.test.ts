import {
  MAX_REPOSITORY_TAG_LENGTH,
  MAX_REPOSITORY_TAGS,
  moveRepositoryTag,
  normalizeRepositoryTags,
  repositoryMatchesTagFilter,
} from "@/lib/repositories/tags";

describe("repository tags", () => {
  it("normalizes whitespace, casing, unicode, and duplicates", () => {
    expect(
      normalizeRepositoryTags([
        " Infra ",
        "INFRA",
        "retro   gaming",
        "ＭＥＤＩＡ",
      ]),
    ).toEqual({
      success: true,
      tags: ["infra", "retro gaming", "media"],
    });
  });

  it("rejects invalid and excessive tags", () => {
    expect(normalizeRepositoryTags(["bad,tag"])).toEqual({
      success: false,
      error: "invalid_characters",
    });
    expect(normalizeRepositoryTags(["bad\ttag"])).toEqual({
      success: false,
      error: "invalid_characters",
    });
    expect(normalizeRepositoryTags(["bad\ntag"])).toEqual({
      success: false,
      error: "invalid_characters",
    });
    expect(normalizeRepositoryTags(["bad\u0085tag"])).toEqual({
      success: false,
      error: "invalid_characters",
    });
    expect(normalizeRepositoryTags(["bad\u2028tag"])).toEqual({
      success: false,
      error: "invalid_characters",
    });
    expect(normalizeRepositoryTags(["bad\u2029tag"])).toEqual({
      success: false,
      error: "invalid_characters",
    });
    expect(
      normalizeRepositoryTags(["x".repeat(MAX_REPOSITORY_TAG_LENGTH + 1)]),
    ).toEqual({
      success: false,
      error: "too_long",
    });
    expect(
      normalizeRepositoryTags(
        Array.from({ length: MAX_REPOSITORY_TAGS + 1 }, (_, index) =>
          String(index),
        ),
      ),
    ).toEqual({ success: false, error: "too_many" });
  });

  it("counts non-BMP Unicode characters as single code points", () => {
    expect(normalizeRepositoryTags(["😀".repeat(40)])).toEqual({
      success: true,
      tags: ["😀".repeat(40)],
    });
    expect(normalizeRepositoryTags(["😀".repeat(41)])).toEqual({
      success: false,
      error: "too_long",
    });
  });

  it("matches selected tags with OR semantics and supports untagged repos", () => {
    const selected = new Set(["infra", "media"]);

    expect(repositoryMatchesTagFilter(["infra"], selected, false)).toBe(true);
    expect(repositoryMatchesTagFilter(["retro"], selected, false)).toBe(false);
    expect(repositoryMatchesTagFilter([], selected, true)).toBe(true);
    expect(repositoryMatchesTagFilter(["retro"], new Set(), false)).toBe(true);
  });

  it("moves tags while preserving all other positions", () => {
    const tags = ["infra", "media", "retro"];

    expect(moveRepositoryTag(tags, 0, 2)).toEqual(["media", "retro", "infra"]);
    expect(moveRepositoryTag(tags, 2, 1)).toEqual(["infra", "retro", "media"]);
    expect(moveRepositoryTag(tags, 1, 1)).toBe(tags);
    expect(moveRepositoryTag(tags, -1, 1)).toBe(tags);
  });
});
