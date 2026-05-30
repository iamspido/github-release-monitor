"use client";

import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";
import { updateSettingsAction } from "@/app/settings/actions";
import { EmptyState } from "@/components/empty-state";
import { ExportButton } from "@/components/export-button";
import { RefreshButton } from "@/components/refresh-button";
import { ReleaseCard } from "@/components/release-card";
import { RepositoryForm } from "@/components/repository-form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  normalizeReleaseSortOrder,
  sortEnrichedReleases,
} from "@/lib/release-sort";
import { isSecurityRelease } from "@/lib/security-release";
import { reloadIfServerActionStale } from "@/lib/server-action-error";
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
  canMutate?: boolean;
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
  canMutate = true,
}: HomePageClientProps) {
  const t = useTranslations("HomePage");
  const tActions = useTranslations("Actions");
  const { toast } = useToast();

  const [formattedLastUpdated, setFormattedLastUpdated] = React.useState("");
  const [releaseSortOrder, setReleaseSortOrder] =
    React.useState<ReleaseSortOrder>(
      normalizeReleaseSortOrder(settings.releaseSortOrder),
    );
  const [isSortSaving, startSortSavingTransition] = React.useTransition();
  const [repositoryFormExpanded, setRepositoryFormExpanded] =
    React.useState<boolean>(settings.repositoryFormExpanded ?? true);
  const [isRepositoryFormSaving, startRepositoryFormSavingTransition] =
    React.useTransition();

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
    setReleaseSortOrder(normalizeReleaseSortOrder(settings.releaseSortOrder));
  }, [settings.releaseSortOrder]);

  React.useEffect(() => {
    setRepositoryFormExpanded(settings.repositoryFormExpanded ?? true);
  }, [settings.repositoryFormExpanded]);

  const handleSortOrderChange = (value: ReleaseSortOrder) => {
    const previousValue = releaseSortOrder;
    setReleaseSortOrder(value);

    if (!canMutate) {
      return;
    }

    startSortSavingTransition(async () => {
      try {
        const result = await updateSettingsAction({
          ...settings,
          releaseSortOrder: value,
        });

        if (!result.success) {
          setReleaseSortOrder(previousValue);
          toast({
            title: result.message.title,
            description: result.message.description,
            variant: "destructive",
          });
        }
      } catch (error: unknown) {
        if (reloadIfServerActionStale(error)) {
          return;
        }
        setReleaseSortOrder(previousValue);
        toast({
          title: t("sort_save_error_title"),
          description: t("sort_save_error_description"),
          variant: "destructive",
        });
      }
    });
  };

  const handleRepositoryFormToggle = () => {
    const previousValue = repositoryFormExpanded;
    const nextValue = !previousValue;
    setRepositoryFormExpanded(nextValue);

    if (!canMutate) {
      return;
    }

    startRepositoryFormSavingTransition(async () => {
      try {
        const result = await updateSettingsAction({
          ...settings,
          repositoryFormExpanded: nextValue,
        });

        if (!result.success) {
          setRepositoryFormExpanded(previousValue);
          toast({
            title: result.message.title,
            description: result.message.description,
            variant: "destructive",
          });
        }
      } catch (error: unknown) {
        if (reloadIfServerActionStale(error)) {
          return;
        }
        setRepositoryFormExpanded(previousValue);
        toast({
          title: t("repository_form_toggle_save_error_title"),
          description: t("repository_form_toggle_save_error_description"),
          variant: "destructive",
        });
      }
    });
  };

  const sortedReleases = React.useMemo(
    () =>
      sortEnrichedReleases(
        releases,
        releaseSortOrder,
        settings.providerSortOrder,
        settings.prioritizeNewSecurityReleases,
        settings,
      ),
    [releases, releaseSortOrder, settings],
  );
  const repositoryStats = React.useMemo(() => {
    const newCount = releases.filter((item) => Boolean(item.isNew)).length;
    const securityCount = releases.filter(
      (item) =>
        Boolean(item.isNew) && isSecurityRelease(item.release, settings),
    ).length;

    return { newCount, securityCount };
  }, [releases, settings]);

  return (
    <>
      {canMutate && (
        <RepositoryForm
          currentRepositories={repositories}
          isExpanded={repositoryFormExpanded}
          isExpansionSaving={isRepositoryFormSaving}
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
                t("repo_count", { count: repositories.length }),
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
            <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
              <label
                htmlFor="release-sort-order"
                className="text-sm font-medium text-muted-foreground"
              >
                {t("sort_label")}
              </label>
              <Select
                value={releaseSortOrder}
                onValueChange={(value: ReleaseSortOrder) =>
                  handleSortOrderChange(value)
                }
                disabled={!canMutate || isSortSaving}
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
        ) : (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {sortedReleases.map((enrichedRelease) => (
              <ReleaseCard
                key={enrichedRelease.repoId}
                enrichedRelease={enrichedRelease}
                settings={settings}
                canMutate={canMutate}
              />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
