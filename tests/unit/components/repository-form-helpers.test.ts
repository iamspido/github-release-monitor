import {
  getRepositoryDisplayName,
  getRepositoryProviderName,
  isComposeFileName,
  isHttpUrl,
  isOwnerRepoShorthand,
  parseRepositoryImportJson,
  readTextFile,
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
        id: "gitlab:gitlab.example.com/group/project",
        url: "https://gitlab.example.com/group/project",
      }),
    ).toBe("gitlab.example.com/group/project");
    expect(
      getRepositoryProviderName({
        id: "codeberg:owner/repo",
        url: "https://codeberg.org/owner/repo",
      }),
    ).toBe("Codeberg");
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
