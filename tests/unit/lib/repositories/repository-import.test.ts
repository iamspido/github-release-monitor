import { parseImportedRepository } from "@/lib/repositories/repository-import";

describe("repository import tags", () => {
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
});
