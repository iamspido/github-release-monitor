"use client";

import { AlertTriangle, LayoutGrid, List } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";
import { EmptyState } from "@/components/empty-state";
import { ExportButton } from "@/components/export-button";
import { RefreshButton } from "@/components/refresh-button";
import { ReleaseCard } from "@/components/release-card";
import { RepositoryForm } from "@/components/repository-form";
import { RepositoryTagFilter } from "@/components/repository-tag-filter";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useOptimisticSettingsPatch } from "@/hooks/use-optimistic-settings-patch";
import { useReleaseViewMode } from "@/hooks/use-release-view-mode";
import {
  normalizeReleaseSortOrder,
  sortEnrichedReleases,
} from "@/lib/release-sort";
import type { ReleaseViewMode } from "@/lib/release-view-mode";
import { repositoryMatchesTagFilter } from "@/lib/repositories/tags";
import { isSecurityRelease } from "@/lib/security-release";
import type {
  AppSettings,
  EnrichedRelease,
  FetchError,
  ReleaseSortOrder,
  Repository,
} from "@/types";

interface HomePageClientProps {
  repositories: Repository[];
  releases: EnrichedRelease[];
  settings: AppSettings;
  error: string | null;
  generalError: string | null;
  errorSummary: Map<Exclude<FetchError["type"], "not_modified">, number> | null;
  lastUpdated: Date;
  locale: string;
  initialViewMode: ReleaseViewMode;
  canMutate?: boolean;
  isAppriseConfigured?: boolean;
}

// Helper to get the translation key for a specific error type.
function getErrorTranslationKey(
  errorType: Exclude<FetchError["type"], "not_modified">,
): string {
  const keyMap: Record<Exclude<FetchError["type"], "not_modified">, string> = {
    repo_not_found: "error_repo_not_found",
    no_releases_found: "error_no_releases_found",
    no_matching_releases: "error_no_matching_releases",
    invalid_url: "error_invalid_url",
    api_error: "error_generic_fetch",
    rate_limit: "error_rate_limit",
  };
  return keyMap[errorType];
}

export function HomePageClient({
  repositories,
  releases,
  settings,
  error,
  generalError,
  errorSummary,
  lastUpdated,
  locale,
  initialViewMode,
  canMutate = true,
  isAppriseConfigured = false,
}: HomePageClientProps) {
  const t = useTranslations("HomePage");
  const tActions = useTranslations("Actions");

  const [formattedLastUpdated, setFormattedLastUpdated] = React.useState("");
  const [repositoryTagsById, setRepositoryTagsById] = React.useState(
    () =>
      new Map(
        repositories.map((repository) => [
          repository.id,
          repository.tags ?? [],
        ]),
      ),
  );
  const [repositoryPinnedById, setRepositoryPinnedById] = React.useState(
    () =>
      new Map(
        repositories.map((repository) => [
          repository.id,
          repository.isPinned === true,
        ]),
      ),
  );
  const [selectedTags, setSelectedTags] = React.useState<Set<string>>(
    () => new Set(),
  );
  const [includeUntagged, setIncludeUntagged] = React.useState(false);
  const [openRepositorySettings, setOpenRepositorySettings] = React.useState<
    Set<string>
  >(() => new Set());
  const { updateViewMode, viewMode } = useReleaseViewMode(initialViewMode);
  const sortSetting = useOptimisticSettingsPatch<ReleaseSortOrder>({
    canMutate,
    serverValue: normalizeReleaseSortOrder(settings.releaseSortOrder),
    createPatch: (releaseSortOrder) => ({ releaseSortOrder }),
    unexpectedError: {
      title: t("sort_save_error_title"),
      description: t("sort_save_error_description"),
    },
  });
  const repositoryFormSetting = useOptimisticSettingsPatch<boolean>({
    canMutate,
    serverValue: settings.repositoryFormExpanded ?? true,
    createPatch: (repositoryFormExpanded) => ({ repositoryFormExpanded }),
    unexpectedError: {
      title: t("repository_form_toggle_save_error_title"),
      description: t("repository_form_toggle_save_error_description"),
    },
  });

  React.useEffect(() => {
    // This effect runs only on the client, after the initial render.
    // This prevents the hydration mismatch between server and client time.
    setFormattedLastUpdated(
      lastUpdated.toLocaleTimeString(locale, {
        hour12: settings.timeFormat === "12h",
      }),
    );
  }, [lastUpdated, locale, settings.timeFormat]);

  React.useEffect(() => {
    setRepositoryTagsById(
      new Map(
        repositories.map((repository) => [
          repository.id,
          repository.tags ?? [],
        ]),
      ),
    );
    setRepositoryPinnedById(
      new Map(
        repositories.map((repository) => [
          repository.id,
          repository.isPinned === true,
        ]),
      ),
    );
  }, [repositories]);

  const handleSortOrderChange = (value: ReleaseSortOrder) => {
    sortSetting.update(value);
  };

  const handleRepositoryFormToggle = () => {
    repositoryFormSetting.update(!repositoryFormSetting.value);
  };

  const sortedReleases = React.useMemo(
    () =>
      sortEnrichedReleases(
        releases.map((release) => ({
          ...release,
          repoSettings: {
            ...release.repoSettings,
            isPinned:
              repositoryPinnedById.get(release.repoId) ??
              release.repoSettings?.isPinned,
          },
        })),
        sortSetting.value,
        settings.providerSortOrder,
        settings.prioritizeNewSecurityReleases,
        settings,
      ),
    [releases, repositoryPinnedById, sortSetting.value, settings],
  );
  const tagFilterOptions = React.useMemo(() => {
    const counts = new Map<string, number>();
    let untaggedCount = 0;

    for (const repository of repositories) {
      const tags = repositoryTagsById.get(repository.id) ?? [];
      if (tags.length === 0) untaggedCount += 1;
      for (const tag of tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }

    return {
      options: Array.from(counts, ([tag, count]) => ({ tag, count })).sort(
        (left, right) => left.tag.localeCompare(right.tag, locale),
      ),
      untaggedCount,
    };
  }, [repositories, repositoryTagsById, locale]);
  React.useEffect(() => {
    const availableTags = new Set(
      tagFilterOptions.options.map(({ tag }) => tag),
    );

    setSelectedTags((current) => {
      const next = new Set(
        Array.from(current).filter((tag) => availableTags.has(tag)),
      );
      return next.size === current.size ? current : next;
    });

    if (tagFilterOptions.untaggedCount === 0) {
      setIncludeUntagged(false);
    }
  }, [tagFilterOptions]);
  const visibleReleases = React.useMemo(
    () =>
      sortedReleases.filter(
        (release) =>
          openRepositorySettings.has(release.repoId) ||
          repositoryMatchesTagFilter(
            repositoryTagsById.get(release.repoId) ?? [],
            selectedTags,
            includeUntagged,
          ),
      ),
    [
      sortedReleases,
      repositoryTagsById,
      selectedTags,
      includeUntagged,
      openRepositorySettings,
    ],
  );
  const isTagFilterActive = selectedTags.size > 0 || includeUntagged;
  const repositoryStats = React.useMemo(() => {
    const newCount = visibleReleases.filter((item) =>
      Boolean(item.isNew),
    ).length;
    const securityCount = visibleReleases.filter(
      (item) =>
        Boolean(item.isNew) && isSecurityRelease(item.release, settings),
    ).length;

    return { newCount, securityCount };
  }, [visibleReleases, settings]);

  const handleTagToggle = (tag: string) => {
    setSelectedTags((current) => {
      const next = new Set(current);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  };

  const clearTagFilter = () => {
    setSelectedTags(new Set());
    setIncludeUntagged(false);
  };

  const handleRepositoryTagsChange = (repoId: string, tags: string[]) => {
    setRepositoryTagsById((current) => {
      const next = new Map(current);
      next.set(repoId, tags);
      return next;
    });
  };

  const handleRepositoryPinnedChange = (repoId: string, isPinned: boolean) => {
    setRepositoryPinnedById((current) => {
      const next = new Map(current);
      next.set(repoId, isPinned);
      return next;
    });
  };

  const handleRepositorySettingsOpenChange = (
    repoId: string,
    open: boolean,
  ) => {
    setOpenRepositorySettings((current) => {
      const next = new Set(current);
      if (open) next.add(repoId);
      else next.delete(repoId);
      return next;
    });
  };

  return (
    <>
      {canMutate && (
        <RepositoryForm
          currentRepositories={repositories}
          availableTags={tagFilterOptions.options.map((option) => option.tag)}
          isExpanded={repositoryFormSetting.value}
          isExpansionSaving={repositoryFormSetting.isSaving}
          onToggleExpanded={handleRepositoryFormToggle}
        />
      )}

      <section className="mt-8">
        <div className="mb-4 flex flex-col gap-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="min-w-0 text-2xl font-semibold leading-tight">
              {t("monitored_repos_title")}
            </h2>
            <span className="shrink-0 text-sm text-muted-foreground sm:text-right">
              {[
                isTagFilterActive
                  ? t("filtered_repo_count", {
                      visible: visibleReleases.length,
                      total: repositories.length,
                    })
                  : t("repo_count", { count: repositories.length }),
                t("new_repo_count", { count: repositoryStats.newCount }),
                t("security_repo_count", {
                  count: repositoryStats.securityCount,
                }),
              ].join(" | ")}
              {formattedLastUpdated &&
                ` | ${t("last_updated", { time: formattedLastUpdated })}`}
            </span>
          </div>
          <div className="flex w-full flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
            <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center sm:justify-end">
              <ExportButton />
              {canMutate && <RefreshButton />}
            </div>
            <RepositoryTagFilter
              options={tagFilterOptions.options}
              untaggedCount={tagFilterOptions.untaggedCount}
              selectedTags={selectedTags}
              includeUntagged={includeUntagged}
              onTagToggle={handleTagToggle}
              onUntaggedToggle={() => setIncludeUntagged((current) => !current)}
              onClear={clearTagFilter}
            />
            <fieldset className="grid grid-cols-2 rounded-md border p-0.5">
              <legend className="sr-only">{t("view_mode_label")}</legend>
              <Button
                type="button"
                variant={viewMode === "cards" ? "secondary" : "ghost"}
                size="sm"
                className="h-8 px-2"
                onClick={() => updateViewMode("cards")}
                aria-pressed={viewMode === "cards"}
                aria-label={t("view_mode_cards")}
                title={t("view_mode_cards")}
              >
                <LayoutGrid className="size-4" />
                <span className="hidden lg:inline">{t("view_mode_cards")}</span>
              </Button>
              <Button
                type="button"
                variant={viewMode === "compact" ? "secondary" : "ghost"}
                size="sm"
                className="h-8 px-2"
                onClick={() => updateViewMode("compact")}
                aria-pressed={viewMode === "compact"}
                aria-label={t("view_mode_compact")}
                title={t("view_mode_compact")}
              >
                <List className="size-4" />
                <span className="hidden lg:inline">
                  {t("view_mode_compact")}
                </span>
              </Button>
            </fieldset>
            <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
              <label
                htmlFor="release-sort-order"
                className="text-sm font-medium text-muted-foreground"
              >
                {t("sort_label")}
              </label>
              <Select
                value={sortSetting.value}
                onValueChange={(value: ReleaseSortOrder) =>
                  handleSortOrderChange(value)
                }
                disabled={!canMutate || sortSetting.isSaving}
              >
                <SelectTrigger
                  id="release-sort-order"
                  className="h-9 w-full sm:w-[220px]"
                >
                  <SelectValue placeholder={t("sort_latest_first")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="latest_first">
                    {t("sort_latest_first")}
                  </SelectItem>
                  <SelectItem value="new_first">
                    {t("sort_new_first")}
                  </SelectItem>
                  <SelectItem value="oldest_first">
                    {t("sort_oldest_first")}
                  </SelectItem>
                  <SelectItem value="repo_az">{t("sort_repo_az")}</SelectItem>
                  <SelectItem value="repo_za">{t("sort_repo_za")}</SelectItem>
                  <SelectItem value="provider_grouped">
                    {t("sort_provider_grouped")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {error && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertTriangle className="size-5 shrink-0" />
            <p>{error}</p>
          </div>
        )}
        {generalError && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-yellow-500/50 bg-yellow-500/10 p-3 text-sm text-yellow-300">
            <AlertTriangle className="size-5 shrink-0" />
            <p>{generalError}</p>
          </div>
        )}
        {errorSummary && errorSummary.size > 0 && (
          <div className="mb-4 flex flex-col items-start gap-3 rounded-lg border border-yellow-500/50 bg-yellow-500/10 p-4 text-sm text-yellow-300">
            <div className="flex items-center gap-2 font-semibold">
              <AlertTriangle className="size-5 shrink-0" />
              <p>{t("error_summary_title")}</p>
            </div>
            <ul className="list-disc pl-10 space-y-1">
              {Array.from(errorSummary.entries()).map(([type, count]) => (
                <li key={type}>
                  {t("error_summary_line", {
                    count,
                    errorText: tActions(getErrorTranslationKey(type)),
                  })}
                </li>
              ))}
            </ul>
          </div>
        )}

        {repositories.length === 0 ? (
          <EmptyState canMutate={canMutate} />
        ) : visibleReleases.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <p className="text-muted-foreground">{t("tag_filter_empty")}</p>
            <Button
              type="button"
              variant="outline"
              className="mt-4"
              onClick={clearTagFilter}
            >
              {t("tag_filter_clear")}
            </Button>
          </div>
        ) : (
          <div
            className={
              viewMode === "cards"
                ? "grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3"
                : "grid grid-cols-[repeat(auto-fill,minmax(min(100%,28rem),1fr))] items-start gap-2"
            }
          >
            {visibleReleases.map((enrichedRelease) => (
              <ReleaseCard
                key={enrichedRelease.repoId}
                enrichedRelease={enrichedRelease}
                availableRepositoryTags={tagFilterOptions.options.map(
                  (option) => option.tag,
                )}
                repositoryTags={
                  repositoryTagsById.get(enrichedRelease.repoId) ?? []
                }
                onRepositoryTagsChange={(tags) =>
                  handleRepositoryTagsChange(enrichedRelease.repoId, tags)
                }
                onPinnedChange={(isPinned) =>
                  handleRepositoryPinnedChange(enrichedRelease.repoId, isPinned)
                }
                onSettingsOpenChange={(open) =>
                  handleRepositorySettingsOpenChange(
                    enrichedRelease.repoId,
                    open,
                  )
                }
                settings={settings}
                variant={viewMode === "compact" ? "compact" : "card"}
                canMutate={canMutate}
                isAppriseConfigured={isAppriseConfigured}
              />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
