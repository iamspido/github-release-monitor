'use server';

import { logger } from '@/lib/logger';
import type { SystemStatus } from '@/types';
import { getSystemStatus, saveSystemStatus } from '@/lib/system-status';

const log = logger.withScope('UpdateCheck');
const GITHUB_RELEASES_API =
  'https://api.github.com/repos/iamspido/github-release-monitor/releases/latest';

type GithubLatestReleaseResponse = {
  tag_name?: string | null;
  name?: string | null;
};

export async function runApplicationUpdateCheck(
  currentVersion: string
): Promise<SystemStatus> {
  const previousStatus = await getSystemStatus();
  const headers: HeadersInit = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'GitHubReleaseMonitorApp',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  if (previousStatus.latestEtag) {
    headers['If-None-Match'] = previousStatus.latestEtag;
  }

  if (process.env.GITHUB_ACCESS_TOKEN) {
    headers['Authorization'] = `token ${process.env.GITHUB_ACCESS_TOKEN}`;
  }

  const nowIso = new Date().toISOString();

  try {
    const response = await fetch(GITHUB_RELEASES_API, {
      cache: 'no-store',
      headers,
    });

    if (response.status === 304) {
      const updated: SystemStatus = {
        ...previousStatus,
        lastCheckedAt: nowIso,
        lastCheckError: null,
      };
      await saveSystemStatus(updated);
      log.debug('Update check: release information unchanged (304).');
      return updated;
    }

    if (!response.ok) {
      const message = `${response.status} ${response.statusText}`;
      const updated: SystemStatus = {
        ...previousStatus,
        lastCheckedAt: nowIso,
        lastCheckError: message,
      };
      await saveSystemStatus(updated);
      log.warn(`Update check failed with HTTP error: ${message}`);
      return updated;
    }

    const payload = (await response.json()) as GithubLatestReleaseResponse;
    const latestVersion = payload.tag_name || payload.name || null;
    const etag = response.headers.get('etag');

    let dismissedVersion = previousStatus.dismissedVersion;
    if (
      latestVersion &&
      dismissedVersion &&
      dismissedVersion !== latestVersion
    ) {
      dismissedVersion = null;
    }

    const updated: SystemStatus = {
      latestKnownVersion: latestVersion,
      lastCheckedAt: nowIso,
      latestEtag: etag,
      dismissedVersion,
      lastCheckError: null,
    };

    await saveSystemStatus(updated);

    if (!latestVersion) {
      log.warn('Update check succeeded but no version tag was returned.');
    } else if (latestVersion !== currentVersion) {
      log.info(
        `Update available: current=${currentVersion} latest=${latestVersion}`
      );
    } else {
      log.info(`Application is up to date (version ${currentVersion}).`);
    }

    return updated;
  } catch (error: any) {
    const message =
      (error && typeof error.message === 'string'
        ? error.message
        : 'unexpected_error');
    const updated: SystemStatus = {
      ...previousStatus,
      lastCheckedAt: nowIso,
      lastCheckError: message,
    };
    await saveSystemStatus(updated);
    log.error('Update check failed with exception:', error);
    return updated;
  }
}
