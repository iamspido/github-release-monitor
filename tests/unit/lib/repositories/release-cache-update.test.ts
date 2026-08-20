import { applyReleaseFetchResultToRepository } from "@/lib/repositories/release-cache-update";
import type { CachedRelease, Repository } from "@/types";

const cachedRelease: CachedRelease = {
  html_url: "https://github.com/owner/repo/releases/tag/v1.0.0",
  tag_name: "v1.0.0",
  name: "v1.0.0",
  body: "body",
  created_at: "2024-01-01T00:00:00.000Z",
  published_at: "2024-01-01T00:00:00.000Z",
  fetched_at: "2024-01-01T00:00:01.000Z",
  source: "release",
};

function createRepository(overrides: Partial<Repository> = {}): Repository {
  return {
    id: "owner/repo",
    url: "https://github.com/owner/repo",
    latestRelease: cachedRelease,
    ...overrides,
  };
}

describe("repositories/release-cache-update", () => {
  it("updates ETag even when the fetch result has no release", () => {
    const repository = createRepository({ etag: 'W/"old"' });

    const changed = applyReleaseFetchResultToRepository(repository, {
      release: undefined,
      newEtag: 'W/"new"',
    });

    expect(changed).toBe(true);
    expect(repository.etag).toBe('W/"new"');
    expect(repository.latestRelease).toEqual(cachedRelease);
  });

  it("clears ETag without touching the cached release when newEtag is null", () => {
    const repository = createRepository({ etag: 'W/"stale"' });

    const changed = applyReleaseFetchResultToRepository(repository, {
      release: undefined,
      newEtag: null,
    });

    expect(changed).toBe(true);
    expect(repository.etag).toBeUndefined();
    expect(repository.latestRelease).toEqual(cachedRelease);
  });

  it("reports no change when neither release nor ETag changed", () => {
    const repository = createRepository({ etag: 'W/"same"' });

    const changed = applyReleaseFetchResultToRepository(repository, {
      release: undefined,
      newEtag: 'W/"same"',
    });

    expect(changed).toBe(false);
    expect(repository.etag).toBe('W/"same"');
    expect(repository.latestRelease).toEqual(cachedRelease);
  });

  it("initializes the last-seen baseline from a tag fallback", () => {
    const repository = createRepository({
      latestRelease: undefined,
      lastSeenReleaseTag: undefined,
    });

    const changed = applyReleaseFetchResultToRepository(
      repository,
      {
        release: {
          id: 0,
          html_url: "https://github.com/owner/repo/releases/tag/v2.0.0",
          tag_name: "v2.0.0",
          name: "Tag: v2.0.0",
          body: "tag body",
          created_at: "2024-02-01T00:00:00.000Z",
          published_at: "2024-02-01T00:00:00.000Z",
          prerelease: false,
          draft: false,
        },
      },
      { initializeLastSeenFromFetchedRelease: true },
    );

    expect(changed).toBe(true);
    expect(repository.lastSeenReleaseTag).toBe("v2.0.0");
    expect(repository.latestRelease?.source).toBe("tag");
  });

  it("replaces a cached formal release with a freshly fetched tag", () => {
    const repository = createRepository();

    const changed = applyReleaseFetchResultToRepository(repository, {
      release: {
        id: 0,
        html_url: "https://github.com/owner/repo/releases/tag/v2.0.0",
        tag_name: "v2.0.0",
        name: "Tag: v2.0.0",
        body: "tag body",
        created_at: "2024-02-01T00:00:00.000Z",
        published_at: "2024-02-01T00:00:00.000Z",
        prerelease: false,
        draft: false,
      },
    });

    expect(changed).toBe(true);
    expect(repository.latestRelease).toMatchObject({
      tag_name: "v2.0.0",
      source: "tag",
    });
  });

  it("does not initialize the baseline from reconstructed cache data", () => {
    const repository = createRepository({ lastSeenReleaseTag: undefined });

    applyReleaseFetchResultToRepository(
      repository,
      {
        release: {
          id: 0,
          html_url: cachedRelease.html_url,
          tag_name: cachedRelease.tag_name,
          name: cachedRelease.name,
          body: cachedRelease.body,
          created_at: cachedRelease.created_at,
          published_at: cachedRelease.published_at,
          prerelease: false,
          draft: false,
        },
        error: { type: "not_modified" },
      },
      { initializeLastSeenFromFetchedRelease: true },
    );

    expect(repository.lastSeenReleaseTag).toBeUndefined();
  });
});
