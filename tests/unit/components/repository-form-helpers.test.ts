import {
  getProviderResolutionBatches,
  getRepositoryDisplayName,
  getRepositoryImportStats,
  getRepositoryProviderName,
  isComposeFileName,
  isHttpUrl,
  isOwnerRepoShorthand,
  parseRepositoryImportJson,
  readTextFile,
  sortProviderChoiceCandidates,
} from "@/components/repository-form-helpers";

const originalFileReader = globalThis.FileReader;

afterEach(() => {
  if (originalFileReader) {
    globalThis.FileReader = originalFileReader;
  } else {
    Reflect.deleteProperty(globalThis, "FileReader");
  }
});

describe("repository-form-helpers", () => {
  it("recognizes repository input variants", () => {
    expect(isHttpUrl(" https://github.com/owner/repo ")).toBe(true);
    expect(isHttpUrl("owner/repo")).toBe(false);
    expect(isOwnerRepoShorthand("owner/repo")).toBe(true);
    expect(isOwnerRepoShorthand("owner/repo/extra")).toBe(false);
    expect(isComposeFileName("compose.yaml")).toBe(true);
    expect(isComposeFileName("repositories.json")).toBe(false);
  });

  it("splits large provider resolution requests into bounded batches", () => {
    const inputs = Array.from(
      { length: 101 },
      (_, index) => `owner/repo-${index}`,
    );
    inputs.push("owner/repo-0");
    inputs.push("https://github.com/owner/direct-url");

    const batches = getProviderResolutionBatches(inputs);

    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(100);
    expect(batches[1]).toEqual(["owner/repo-100"]);
    expect(batches.flat()).not.toContain("https://github.com/owner/direct-url");
  });

  it("parses valid repository import JSON", () => {
    expect(
      parseRepositoryImportJson(
        JSON.stringify([{ id: "github:owner/repo", url: "owner/repo" }]),
      ),
    ).toEqual([{ id: "github:owner/repo", url: "owner/repo" }]);
  });

  it("rejects invalid repository import JSON shapes", () => {
    expect(() => parseRepositoryImportJson("{}")).toThrow("invalid_format");
    expect(() =>
      parseRepositoryImportJson(JSON.stringify([{ id: "github:owner/repo" }])),
    ).toThrow("invalid_format");
  });

  it("derives display labels from repository provider ids", () => {
    expect(
      getRepositoryDisplayName({
        id: "gitlab:gitlab.example.test/group/project",
        url: "https://gitlab.example.test/group/project",
      }),
    ).toBe("gitlab.example.test/group/project");
    expect(
      getRepositoryProviderName({
        id: "codeberg:owner/repo",
        url: "https://codeberg.org/owner/repo",
      }),
    ).toBe("Codeberg");
  });

  it("sorts provider choices by preferred provider order and host", () => {
    expect(
      sortProviderChoiceCandidates([
        {
          provider: "codeberg",
          canonicalRepoUrl: "https://codeberg.org/owner/repo",
        },
        {
          provider: "gitlab",
          providerHost: "z.gitlab.test",
          canonicalRepoUrl: "https://z.gitlab.test/owner/repo",
        },
        {
          provider: "github",
          canonicalRepoUrl: "https://github.com/owner/repo",
        },
        {
          provider: "gitlab",
          providerHost: "a.gitlab.test",
          canonicalRepoUrl: "https://a.gitlab.test/owner/repo",
        },
      ]).map((candidate) => candidate.canonicalRepoUrl),
    ).toEqual([
      "https://github.com/owner/repo",
      "https://a.gitlab.test/owner/repo",
      "https://z.gitlab.test/owner/repo",
      "https://codeberg.org/owner/repo",
    ]);
  });

  it("calculates import preview stats against current repositories", () => {
    expect(
      getRepositoryImportStats(
        [
          { id: "github:owner/repo", url: "https://github.com/owner/repo" },
          { id: "codeberg:owner/repo", url: "https://codeberg.org/owner/repo" },
        ],
        new Set(["github:owner/repo"]),
        3,
      ),
    ).toEqual({
      newCount: 1,
      existingCount: 1,
      skippedImages: 3,
    });
  });

  it("reads text files through the FileReader boundary", async () => {
    class FakeFileReader {
      onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
      onerror: (() => void) | null = null;

      readAsText() {
        this.onload?.({
          target: { result: "[]" },
        } as ProgressEvent<FileReader>);
      }
    }

    globalThis.FileReader = FakeFileReader as unknown as typeof FileReader;
    const file = new File(["[]"], "repositories.json", {
      type: "application/json",
    });

    await expect(readTextFile(file)).resolves.toBe("[]");
  });
});
