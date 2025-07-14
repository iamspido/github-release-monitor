import * as React from 'react';
import { getTranslations } from 'next-intl/server';
import type { EnrichedRelease, Repository, AppSettings, FetchError } from '@/types';
import { getLatestReleasesForRepos } from '@/app/actions';
import { getRepositories } from '@/lib/repository-storage';
import { getSettings } from '@/lib/settings-storage';
import { Header } from '@/components/header';
import { BackToTopButton } from '@/components/back-to-top-button';
import { AutoRefresher } from '@/components/auto-refresher';
import { HomePageClient } from '@/components/home-page-client';

// Helper function to find the first general error that is a rate limit error.
function findFirstRateLimitError(releases: EnrichedRelease[]): FetchError | undefined {
  for (const r of releases) {
    if (r.error?.type === 'rate_limit') {
      return r.error;
    }
  }
  return undefined;
}

// Helper function to count all other errors
function countErrors(releases: EnrichedRelease[]): Map<FetchError['type'], number> {
  const errorCounts = new Map<FetchError['type'], number>();
  for (const r of releases) {
    if (r.error && r.error.type !== 'rate_limit') {
      const currentCount = errorCounts.get(r.error.type) || 0;
      errorCounts.set(r.error.type, currentCount + 1);
    }
  }
  return errorCounts;
}

export default async function HomePage({params}: {params: Promise<{locale: string}>}) {
  const { locale } = await params;
  const t = await getTranslations({locale: locale, namespace: 'HomePage'});
  const tActions = await getTranslations({locale: locale, namespace: 'Actions'});
  
  let repositories: Repository[] = [];
  let releases: EnrichedRelease[] = [];
  let error: string | null = null;
  const lastUpdated = new Date();
  let settings: AppSettings;
  let generalError: string | null = null;
  let errorSummary: Map<FetchError['type'], number> | null = null;

  try {
    settings = await getSettings();
    repositories = await getRepositories();
    if (repositories.length > 0) {
      releases = await getLatestReleasesForRepos(repositories, settings, locale);
    }
  } catch (e: any) {
    console.error('Failed to load repositories or releases:', e);
    error = t('load_error');
    settings = { timeFormat: '24h', locale: 'en', refreshInterval: 10, cacheInterval: 5, releaseChannels: ['stable'], showAcknowledge: true };
  }

  // Prioritize showing the rate limit error as it's the most critical.
  const rateLimitError = findFirstRateLimitError(releases);
  if (rateLimitError) {
    generalError = tActions('error_rate_limit');
  } else {
    // If there's no rate limit error, count and summarize the other errors.
    const countedErrors = countErrors(releases);
    if (countedErrors.size > 0) {
      errorSummary = countedErrors;
    }
  }

  return (
    <div className="min-h-screen w-full">
      <AutoRefresher intervalMinutes={settings.refreshInterval} />
      <Header locale={locale} />
      <main className="container mx-auto px-4 py-8 md:px-6">
        <HomePageClient
          repositories={repositories}
          releases={releases}
          settings={settings}
          error={error}
          generalError={generalError}
          errorSummary={errorSummary}
          lastUpdated={lastUpdated}
          locale={locale}
        />
      </main>
      <BackToTopButton />
    </div>
  );
}
