import { sendNotification } from "@/lib/notifications";
import { getLatestReleasesForRepos } from "@/lib/releases";
import { resolveParallelRepoFetches } from "@/lib/releases/filters";
import { hasAnyGitlabTokenForAllowedHosts } from "@/lib/repositories/providers";
import { applyReleaseFetchResultToRepository } from "@/lib/repositories/release-cache-update";
import { filterRepositoriesDueForBackgroundCheck } from "@/lib/runtime/repository-schedule";
import { scheduleTask } from "@/lib/runtime/task-scheduler";
import { log } from "@/lib/server-action-helpers";
import { getRepositories, saveRepositories } from "@/lib/storage/repositories";
import { getSettings } from "@/lib/storage/settings";
import type { AppSettings, EnrichedRelease, Repository } from "@/types";

async function applyReleaseCheckResults({
  originalRepos,
  enrichedReleases,
  settings,
  effectiveLocale,
  backgroundCheckStartedAtIso,
  markDueChecks,
}: {
  originalRepos: Repository[];
  enrichedReleases: EnrichedRelease[];
  settings: AppSettings;
  effectiveLocale: string;
  backgroundCheckStartedAtIso: string;
  markDueChecks: boolean;
}) {
  const updatedRepos = [...originalRepos];
  const repoIndexById = new Map(
    updatedRepos.map((repo, index) => [repo.id, index]),
  );
  let changed = false;
  let notificationsSent = 0;

  for (const enrichedRelease of enrichedReleases) {
    const repoIndex = repoIndexById.get(enrichedRelease.repoId);
    if (repoIndex === undefined) continue;

    const repo = updatedRepos[repoIndex];
    let repoWasUpdated = false;

    if (
      markDueChecks &&
      repo.lastBackgroundCheckAt !== backgroundCheckStartedAtIso
    ) {
      repo.lastBackgroundCheckAt = backgroundCheckStartedAtIso;
      repoWasUpdated = true;
    }

    if (applyReleaseFetchResultToRepository(repo, enrichedRelease)) {
      repoWasUpdated = true;
    }

    if (enrichedRelease.release) {
      const isVirtual = enrichedRelease.release.id === 0; // tag-fallback or reconstructed data
      const newTag = enrichedRelease.release.tag_name;
      const isNewRelease =
        !isVirtual &&
        repo.lastSeenReleaseTag &&
        repo.lastSeenReleaseTag !== newTag;

      if (isNewRelease) {
        log.info(
          `New release detected for ${repo.id}: ${newTag} (previously ${repo.lastSeenReleaseTag})`,
        );

        const shouldHighlight = settings.showAcknowledge ?? true;
        repo.lastSeenReleaseTag = newTag;
        repo.isNew = shouldHighlight;
        repoWasUpdated = true;

        try {
          await sendNotification(
            repo,
            enrichedRelease.release,
            effectiveLocale,
            settings,
          );
          notificationsSent++;
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error ?? "unknown");
          log.error(
            `Failed to send notification for ${repo.id}. The release tag HAS been updated to prevent repeated failures for the same release. Error: ${message}`,
            error instanceof Error ? error : undefined,
          );
        }
      } else if (!repo.lastSeenReleaseTag && !isVirtual) {
        log.info(
          `First fetch for ${repo.id}, setting initial release tag to ${newTag}. No notification will be sent.`,
        );
        repo.lastSeenReleaseTag = newTag;
        repo.isNew = false;
        repoWasUpdated = true;
      }
    }
    if (repoWasUpdated) {
      changed = true;
    }
  }

  return { updatedRepos, changed, notificationsSent };
}

async function _checkForNewReleasesUnscheduled(options?: {
  overrideLocale?: string;
  skipCache?: boolean;
  onlyDue?: boolean;
}) {
  log.info(`Running check for new releases...`);
  const settings = await getSettings();
  const backgroundCheckStartedAt = new Date();
  const backgroundCheckStartedAtIso = backgroundCheckStartedAt.toISOString();
  const effectiveLocale = options?.overrideLocale || settings.locale;
  const parallelLimit = resolveParallelRepoFetches(settings);
  const tokenConfigured = !!process.env.GITHUB_ACCESS_TOKEN?.trim();
  const codebergTokenConfigured = !!process.env.CODEBERG_ACCESS_TOKEN?.trim();
  const gitlabTokenConfigured = hasAnyGitlabTokenForAllowedHosts();
  log.info(
    `Parallel fetch batch size set to ${parallelLimit} (GitHub token=${tokenConfigured ? "yes" : "no"}, Codeberg token=${codebergTokenConfigured ? "yes" : "no"}, GitLab token=${gitlabTokenConfigured ? "yes" : "no"}).`,
  );

  const originalRepos = await getRepositories();
  if (originalRepos.length === 0) {
    log.info(`No repositories to check.`);
    return { notificationsSent: 0, checked: 0 };
  }

  const reposToCheck = options?.onlyDue
    ? filterRepositoriesDueForBackgroundCheck(
        originalRepos,
        settings,
        backgroundCheckStartedAt,
      )
    : originalRepos;

  if (reposToCheck.length === 0) {
    log.info(`No repositories are due for background check.`);
    return { notificationsSent: 0, checked: 0 };
  }

  const enrichedReleases = await getLatestReleasesForRepos(
    reposToCheck,
    settings,
    effectiveLocale,
    { skipCache: options?.skipCache },
  );

  const { updatedRepos, changed, notificationsSent } =
    await applyReleaseCheckResults({
      originalRepos,
      enrichedReleases,
      settings,
      effectiveLocale,
      backgroundCheckStartedAtIso,
      markDueChecks: options?.onlyDue === true,
    });

  if (changed) {
    log.info(`Found changes, updating repository data file.`);
    await saveRepositories(updatedRepos);
  } else {
    log.info(`No new releases found.`);
  }
  log.info(
    `Summary: notificationsSent=${notificationsSent} checked=${reposToCheck.length}`,
  );
  return { notificationsSent, checked: reposToCheck.length };
}

export async function checkForNewReleases(options?: {
  overrideLocale?: string;
  skipCache?: boolean;
  onlyDue?: boolean;
}) {
  return scheduleTask("checkForNewReleases", () =>
    _checkForNewReleasesUnscheduled(options),
  );
}
