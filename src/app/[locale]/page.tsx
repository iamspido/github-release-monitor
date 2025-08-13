import * as React from 'react';
import { getTranslations } from 'next-intl/server';
import type { EnrichedRelease, Repository, AppSettings, FetchError, GithubRelease } from '@/types';
import { getRepositories } from '@/lib/repository-storage';
import { getSettings } from '@/lib/settings-storage';
import { Header } from '@/components/header';
import { BackToTopButton } from '@/components/back-to-top-button';
import { AutoRefresher } from '@/components/auto-refresher';
import { HomePageClient } from '@/components/home-page-client';

export default async function HomePage({params}: {params: Promise<{locale: string}>}) {
  const { locale } = await params;
  const t = await getTranslations({locale: locale, namespace: 'HomePage'});

  let repositories: Repository[] = [];
  let releases: EnrichedRelease[] = [];
  let error: string | null = null;
  const lastUpdated = new Date();
  let settings: AppSettings;
  const generalError: string | null = null;
  const errorSummary: Map<Exclude<FetchError['type'], 'not_modified'>, number> | null = null;

  try {
    settings = await getSettings();
    repositories = await getRepositories();
    if (repositories.length > 0) {
      releases = repositories.map(repo => {
        const cached = repo.latestRelease;
        const reconstructedRelease: GithubRelease | undefined = cached ? {
          ...cached,
          id: 0, // Cached releases might not have a full ID
          prerelease: false, // This info isn't in CachedRelease
          draft: false, // This info isn't in CachedRelease
        } : undefined;

        return {
          repoId: repo.id,
          repoUrl: repo.url,
          release: reconstructedRelease,
          isNew: repo.isNew,
          repoSettings: {
            releaseChannels: repo.releaseChannels,
            preReleaseSubChannels: repo.preReleaseSubChannels,
            releasesPerPage: repo.releasesPerPage,
            includeRegex: repo.includeRegex,
            excludeRegex: repo.excludeRegex,
            appriseTags: repo.appriseTags,
            appriseFormat: repo.appriseFormat,
          },
          // No fetch, so no newEtag and no error
          newEtag: repo.etag,
        };
      });
    }
  } catch (e: any) {
    console.error('Failed to load repositories or releases:', e);
    error = t('load_error');
    settings = { timeFormat: '24h', locale: 'en', refreshInterval: 10, cacheInterval: 5, releaseChannels: ['stable'], showAcknowledge: true, releasesPerPage: 30 };
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
