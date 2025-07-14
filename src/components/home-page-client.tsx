
'use client';

import * as React from 'react';
import { AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { EnrichedRelease, Repository, AppSettings, FetchError } from '@/types';
import { RepositoryForm } from '@/components/repository-form';
import { ReleaseCard } from '@/components/release-card';
import { EmptyState } from '@/components/empty-state';
import { RefreshButton } from '@/components/refresh-button';
import { ExportButton } from '@/components/export-button';

interface HomePageClientProps {
  repositories: Repository[];
  releases: EnrichedRelease[];
  settings: AppSettings;
  error: string | null;
  generalError: string | null;
  errorSummary: Map<FetchError['type'], number> | null;
  lastUpdated: Date;
  locale: string;
}

// Helper to get the translation key for a specific error type.
function getErrorTranslationKey(errorType: FetchError['type']): string {
  const keyMap: Record<FetchError['type'], string> = {
    repo_not_found: 'error_repo_not_found',
    no_releases_found: 'error_no_releases_found',
    no_matching_releases: 'error_no_matching_releases',
    invalid_url: 'error_invalid_url',
    api_error: 'error_generic_fetch',
    rate_limit: 'error_rate_limit',
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
  locale
}: HomePageClientProps) {
  const t = useTranslations('HomePage');
  const tActions = useTranslations('Actions');

  const [formattedLastUpdated, setFormattedLastUpdated] = React.useState('');

  React.useEffect(() => {
    // This effect runs only on the client, after the initial render.
    // This prevents the hydration mismatch between server and client time.
    setFormattedLastUpdated(lastUpdated.toLocaleTimeString(locale, { hour12: settings.timeFormat === '12h' }));
  }, [lastUpdated, locale, settings.timeFormat]);


  const sortedReleases = React.useMemo(() => 
    [...releases].sort((a, b) => {
        const dateA = a.release?.published_at || a.release?.created_at;
        const dateB = b.release?.published_at || b.release?.created_at;

        if (!dateA) return 1;
        if (!dateB) return -1;
        
        return new Date(dateB).getTime() - new Date(dateA).getTime();
    }), [releases]);

  return (
    <>
      <RepositoryForm currentRepositories={repositories} />

      <section className="mt-8">
        <div className="mb-4 flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-2xl font-semibold">{t('monitored_repos_title')}</h2>
          <div className="flex w-full flex-col items-stretch gap-3 sm:w-auto sm:flex-row sm:items-center sm:gap-4">
            <span className="text-sm text-muted-foreground text-center sm:text-left">
              {t('repo_count', { count: repositories.length })}
              {formattedLastUpdated && ` | ${t('last_updated', { time: formattedLastUpdated })}`}
            </span>
            <div className="flex items-stretch gap-2 justify-center sm:w-auto sm:items-center">
              <ExportButton />
              <RefreshButton />
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
              <p>{t('error_summary_title')}</p>
            </div>
            <ul className="list-disc pl-10 space-y-1">
              {Array.from(errorSummary.entries()).map(([type, count]) => (
                <li key={type}>
                  {t('error_summary_line', { 
                    count, 
                    errorText: tActions(getErrorTranslationKey(type)) 
                  })}
                </li>
              ))}
            </ul>
          </div>
        )}

        {repositories.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {sortedReleases.map(enrichedRelease => (
              <ReleaseCard
                key={enrichedRelease.repoId}
                enrichedRelease={enrichedRelease}
                settings={settings}
              />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
