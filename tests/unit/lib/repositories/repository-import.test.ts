import { parseImportedRepository } from "@/lib/repositories/repository-import";

describe("repository import metadata", () => {
  afterEach(() => {
    delete process.env.FORGEJO_ADDITIONAL_BASE_URLS;
  });

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

  it("imports repositories from configured Forgejo base URLs", () => {
    process.env.FORGEJO_ADDITIONAL_BASE_URLS = "https://scm.example.test/code";

    expect(
      parseImportedRepository({
        url: "https://scm.example.test/code/Owner/Repo.git",
      }),
    ).toEqual({
      id: "forgejo:scm.example.test/code/owner/repo",
      url: "https://scm.example.test/code/Owner/Repo",
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
    const pattern =
      "^docker/(?<version>\\d+\\.\\d+\\.\\d+)-r(?<revision>\\d+)$";
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

  it.each([
    null,
    [],
    {},
    { url: 42 },
    { url: "https://example.test/owner/repo" },
  ])("rejects unsupported repository payload %j", (payload) => {
    expect(parseImportedRepository(payload)).toBeNull();
  });

  it("preserves all supported repository settings from an export", () => {
    const result = parseImportedRepository({
      url: "https://github.com/Owner/Repo.git",
      displayName: " Production ",
      lastSeenReleaseTag: "v1.0.0",
      isNew: true,
      isPinned: true,
      etag: '"etag-1"',
      latestRelease: {
        html_url: "https://github.com/Owner/Repo/releases/tag/v1.1.0",
        tag_name: "v1.1.0",
        created_at: "2026-07-01T10:00:00.000Z",
        name: " Release 1.1 ",
        body: "Notes",
        commit_links: [
          {
            ref: "1234567",
            sha: "1234567890123456789012345678901234567890",
            url: "https://github.com/Owner/Repo/commit/1234567890123456789012345678901234567890",
          },
          {
            ref: "abcdefa",
            sha: "abcdefabcdefabcdefabcdefabcdefabcdefabcd",
            url: "https://github.com/Owner/Repo/commit/abcdefabcdefabcdefabcdefabcdefabcdefabcd",
          },
        ],
        commit_links_resolved_at: "2026-07-03T09:00:00.000Z",
        published_at: "2026-07-02T10:00:00.000Z",
        published_at_unknown: false,
        fetched_at: "2026-07-03T10:00:00.000Z",
        source: "release",
        ignored: "not imported",
      },
      tags: [" Production ", "backend"],
      releaseChannels: ["stable", "prerelease"],
      preReleaseSubChannels: ["beta", "rc"],
      customPreReleaseMarkers: [" Testing ", "testing", "EDGE"],
      releaseSelectionStrategy: "highest_version",
      versionTagPattern: "^v(?<version>\\d+\\.\\d+\\.\\d+)$",
      releasesPerPage: 25,
      refreshInterval: null,
      cacheInterval: 60,
      backgroundCheckCron: "0 8 * * *",
      lastBackgroundCheckAt: "2026-07-04T10:00:00.000Z",
      includeRegex: "^v",
      excludeRegex: "-dev$",
      appriseTags: "release",
      appriseFormat: "markdown",
      lastNotificationDelivery: { status: "sent" },
      unknownSetting: true,
    });

    expect(result).toEqual({
      id: "github:owner/repo",
      url: "https://github.com/Owner/Repo",
      displayName: "Production",
      lastSeenReleaseTag: "v1.0.0",
      isNew: true,
      isPinned: true,
      etag: '"etag-1"',
      latestRelease: {
        html_url: "https://github.com/Owner/Repo/releases/tag/v1.1.0",
        tag_name: "v1.1.0",
        created_at: "2026-07-01T10:00:00.000Z",
        name: " Release 1.1 ",
        body: "Notes",
        published_at: "2026-07-02T10:00:00.000Z",
        published_at_unknown: false,
        fetched_at: "2026-07-03T10:00:00.000Z",
        source: "release",
      },
      tags: ["production", "backend"],
      releaseChannels: ["stable", "prerelease"],
      preReleaseSubChannels: ["beta", "rc"],
      customPreReleaseMarkers: ["testing", "edge"],
      releaseSelectionStrategy: "highest_version",
      versionTagPattern: "^v(?<version>\\d+\\.\\d+\\.\\d+)$",
      releasesPerPage: 25,
      refreshInterval: null,
      cacheInterval: 60,
      backgroundCheckCron: "0 8 * * *",
      lastBackgroundCheckAt: "2026-07-04T10:00:00.000Z",
      includeRegex: "^v",
      excludeRegex: "-dev$",
      appriseTags: "release",
      appriseFormat: "markdown",
    });
  });

  it("migrates supported and legacy short pre-release channels independently", () => {
    expect(
      parseImportedRepository({
        url: "https://github.com/owner/repo",
        preReleaseSubChannels: ["rc", "b"],
      }),
    ).toMatchObject({
      preReleaseSubChannels: ["rc"],
      customPreReleaseMarkers: ["b"],
    });
  });

  it("ignores invalid custom pre-release marker metadata", () => {
    expect(
      parseImportedRepository({
        url: "https://github.com/owner/repo",
        customPreReleaseMarkers: ["."],
      }),
    ).not.toHaveProperty("customPreReleaseMarkers");
  });

  it("fills legacy cached release defaults", () => {
    expect(
      parseImportedRepository({
        url: "https://gitlab.com/owner/repo",
        latestRelease: {
          html_url: "https://gitlab.com/owner/repo/-/tags/v1",
          tag_name: "v1",
          created_at: "2026-07-01T10:00:00.000Z",
        },
      }),
    ).toMatchObject({
      latestRelease: {
        html_url: "https://gitlab.com/owner/repo/-/tags/v1",
        tag_name: "v1",
        created_at: "2026-07-01T10:00:00.000Z",
        name: null,
        body: null,
        published_at: null,
      },
    });
  });

  it("drops derived commit-link metadata from imported releases", () => {
    const baseRelease = {
      html_url: "https://github.com/owner/repo/releases/tag/v1.0.0",
      tag_name: "v1.0.0",
      created_at: "2026-08-24T10:00:00.000Z",
      name: "v1.0.0",
      body: "Commit 1234567",
      published_at: "2026-08-24T10:00:00.000Z",
      commit_links_retry: {
        attempts: 3,
        retry_at: "2026-08-24T13:00:00.000Z",
      },
      commit_links_resolved_at: "2026-08-24T12:00:00.000Z",
    };

    const latestRelease = parseImportedRepository({
      url: "https://github.com/owner/repo",
      latestRelease: {
        ...baseRelease,
        commit_links: [
          {
            ref: "1234567",
            sha: "1234567890123456789012345678901234567890",
            url: "https://github.com/owner/repo/commit/1234567890123456789012345678901234567890",
          },
        ],
      },
    })?.latestRelease;

    expect(latestRelease).not.toHaveProperty("commit_links");
    expect(latestRelease).not.toHaveProperty("commit_links_resolved_at");
    expect(latestRelease).not.toHaveProperty("commit_links_retry");
  });

  it("ignores malformed optional metadata instead of importing partial values", () => {
    const result = parseImportedRepository({
      url: "https://codeberg.org/owner/repo",
      latestRelease: {
        html_url: "https://codeberg.org/owner/repo/releases/tag/v1",
        tag_name: "v1",
      },
      releaseChannels: ["stable", "unknown"],
      preReleaseSubChannels: ["beta", "unknown"],
      releasesPerPage: Number.POSITIVE_INFINITY,
      refreshInterval: "60",
      cacheInterval: Number.NaN,
      backgroundCheckCron: 42,
      includeRegex: null,
      excludeRegex: false,
      appriseTags: [],
      appriseFormat: "xml",
    });

    expect(result).toEqual({
      id: "codeberg:owner/repo",
      url: "https://codeberg.org/owner/repo",
    });
  });
});
