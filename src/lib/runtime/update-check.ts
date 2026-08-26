import {
  consumeResponseWithTimeout,
  discardResponseWithTimeout,
  fetchWithTimeout,
} from "@/lib/http/fetch-with-timeout";
import { logger } from "@/lib/logger";
import {
  compareAppVersions,
  isStableAppVersion,
} from "@/lib/runtime/app-version";
import { isSecurityRelease } from "@/lib/security-release";
import { updateSystemStatus } from "@/lib/storage/system-status";
import type { SystemStatus } from "@/types";

const log = logger.withScope("UpdateCheck");
const GITHUB_RELEASES_API =
  "https://api.github.com/repos/iamspido/github-release-monitor/releases";
const RELEASES_PER_PAGE = 100;
const MAX_RELEASE_PAGES = 5;

type GithubReleaseResponse = {
  tag_name: string;
  name: string | null;
  body: string | null;
  prerelease: boolean;
  draft: boolean;
};

function getNewestRelease(
  releases: GithubReleaseResponse[],
): GithubReleaseResponse | null {
  return releases.reduce<GithubReleaseResponse | null>(
    (latest, release) =>
      !latest || compareAppVersions(release.tag_name, latest.tag_name) === 1
        ? release
        : latest,
    null,
  );
}

let applicationUpdateCheckQueue: Promise<void> = Promise.resolve();

export function runApplicationUpdateCheck(
  currentVersion: string,
): Promise<SystemStatus> {
  const result = applicationUpdateCheckQueue.then(() =>
    executeApplicationUpdateCheck(currentVersion),
  );

  applicationUpdateCheckQueue = result.then(
    () => undefined,
    () => undefined,
  );

  return result;
}

async function executeApplicationUpdateCheck(
  currentVersion: string,
): Promise<SystemStatus> {
  const headers: HeadersInit = {
    Accept: "application/vnd.github+json",
    "User-Agent": "GitHubReleaseMonitorApp",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  if (process.env.GITHUB_ACCESS_TOKEN) {
    headers.Authorization = `token ${process.env.GITHUB_ACCESS_TOKEN}`;
  }

  const nowIso = new Date().toISOString();

  try {
    const releases: GithubReleaseResponse[] = [];
    let page = 1;

    let reachedPageLimit = false;
    while (true) {
      const response = await fetchWithTimeout(
        `${GITHUB_RELEASES_API}?per_page=${RELEASES_PER_PAGE}&page=${page}`,
        {
          cache: "no-store",
          headers,
        },
      );

      if (!response.ok) {
        await discardResponseWithTimeout(response);
        const message = `${response.status} ${response.statusText}`;
        const updated = await updateSystemStatus((current) => ({
          ...current,
          lastCheckedAt: nowIso,
          lastCheckError: message,
        }));
        log.warn(`Update check failed with HTTP error: ${message}`);
        return updated;
      }

      const payload = await consumeResponseWithTimeout(
        response,
        async (result) => (await result.json()) as GithubReleaseResponse[],
      );
      releases.push(...payload);

      if (payload.length < RELEASES_PER_PAGE) break;

      if (page >= MAX_RELEASE_PAGES) {
        reachedPageLimit = true;
        break;
      }

      page += 1;
    }

    if (reachedPageLimit) {
      throw new Error(`release_list_exceeds_${MAX_RELEASE_PAGES}_pages`);
    }

    const stableReleases = releases.filter(
      (release) =>
        !release.draft &&
        !release.prerelease &&
        isStableAppVersion(release.tag_name),
    );
    const latestRelease = getNewestRelease(stableReleases);
    const newerReleases = stableReleases.filter(
      (release) => compareAppVersions(release.tag_name, currentVersion) === 1,
    );
    const latestSecurityRelease = getNewestRelease(
      newerReleases.filter((release) => isSecurityRelease(release)),
    );
    const latestVersion = latestRelease?.tag_name ?? null;
    const latestReleaseTitle = latestRelease?.name?.trim() || null;
    const latestReleaseIsSecurity = latestRelease
      ? isSecurityRelease(latestRelease)
      : null;
    const latestSecurityVersion = latestSecurityRelease?.tag_name ?? null;

    const updated = await updateSystemStatus((current) => {
      const previousSecurityVersion =
        current.latestSecurityVersion ??
        (current.latestReleaseIsSecurity === true
          ? current.latestKnownVersion
          : null);
      const securityReleaseChanged =
        latestSecurityVersion !== null &&
        previousSecurityVersion !== latestSecurityVersion;
      const shouldClearDismissal =
        Boolean(latestVersion && current.dismissedVersion) &&
        (current.dismissedVersion !== latestVersion || securityReleaseChanged);

      return {
        ...current,
        latestKnownVersion: latestVersion,
        latestReleaseTitle,
        latestReleaseIsSecurity,
        latestSecurityVersion,
        lastCheckedAt: nowIso,
        dismissedVersion: shouldClearDismissal
          ? null
          : current.dismissedVersion,
        lastCheckError: null,
      };
    });

    const latestVersionComparison = compareAppVersions(
      latestVersion,
      currentVersion,
    );
    if (!latestVersion) {
      log.warn("Update check succeeded but no version tag was returned.");
    } else if (latestVersionComparison === 1) {
      log.info(
        `Update available: current=${currentVersion} latest=${latestVersion}`,
      );
    } else if (latestVersionComparison === null) {
      log.warn(
        `Update check returned an invalid version: current=${currentVersion} latest=${latestVersion}`,
      );
    } else {
      log.info(
        `No newer application release: current=${currentVersion} latest=${latestVersion}`,
      );
    }

    return updated;
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "unexpected_error";
    const updated = await updateSystemStatus((current) => ({
      ...current,
      lastCheckedAt: nowIso,
      lastCheckError: message,
    }));
    log.error("Update check failed with exception:", error);
    return updated;
  }
}
