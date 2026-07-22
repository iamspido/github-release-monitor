import { parseImportedRepository } from "@/lib/repositories/repository-import";

describe("repository import metadata", () => {
  it("imports and normalizes a valid repository display name", () => {
    expect(
      parseImportedRepository({
        url: "https://github.com/owner/repo",
        displayName: "  Production Monitor  ",
      }),
    ).toMatchObject({ displayName: "Production Monitor" });
  });

  it("imports and normalizes valid repository tags", () => {
    expect(
      parseImportedRepository({
        url: "https://github.com/owner/repo",
        tags: [" Infra ", "INFRA", "Media"],
      }),
    ).toMatchObject({
      id: "github:owner/repo",
      tags: ["infra", "media"],
    });
  });

  it("ignores an invalid tags field without importing unknown data", () => {
    expect(
      parseImportedRepository({
        url: "https://github.com/owner/repo",
        tags: "infra",
      }),
    ).not.toHaveProperty("tags");
  });

  it("imports a valid pinned state and ignores invalid values", () => {
    expect(
      parseImportedRepository({
        url: "https://github.com/owner/pinned",
        isPinned: true,
      }),
    ).toMatchObject({ isPinned: true });

    expect(
      parseImportedRepository({
        url: "https://github.com/owner/invalid",
        isPinned: "true",
      }),
    ).not.toHaveProperty("isPinned");
  });

  it("imports only supported release selection strategies", () => {
    expect(
      parseImportedRepository({
        url: "https://github.com/owner/highest",
        releaseSelectionStrategy: "highest_version",
      }),
    ).toMatchObject({ releaseSelectionStrategy: "highest_version" });

    expect(
      parseImportedRepository({
        url: "https://github.com/owner/invalid",
        releaseSelectionStrategy: "alphabetical",
      }),
    ).not.toHaveProperty("releaseSelectionStrategy");
  });

  it("imports only valid version tag patterns with a named version group", () => {
    const pattern = "^docker/(?<version>\\d+\\.\\d+\\.\\d+)-r(?<revision>\\d+)$";
    expect(
      parseImportedRepository({
        url: "https://github.com/owner/valid",
        versionTagPattern: `  ${pattern}  `,
      }),
    ).toMatchObject({ versionTagPattern: pattern });

    expect(
      parseImportedRepository({
        url: "https://github.com/owner/invalid",
        versionTagPattern: "^(\\d+\\.\\d+\\.\\d+)$",
      }),
    ).not.toHaveProperty("versionTagPattern");
  });
});
