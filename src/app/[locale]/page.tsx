import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { AutoRefresher } from "@/components/auto-refresher";
import { BackToTopButton } from "@/components/back-to-top-button";
import { Header } from "@/components/header";
import { HomePageClient } from "@/components/home-page-client";
import { getCurrentAuthAccess } from "@/lib/auth/access";
import { logger } from "@/lib/logger";
import { getNotificationRuntimeConfig } from "@/lib/notifications/config";
import {
  normalizeReleaseViewMode,
  RELEASE_VIEW_MODE_COOKIE,
} from "@/lib/release-view-mode";
import { toCachedEnrichedRelease } from "@/lib/releases/cached-enriched-release";
import { toPublicRepository } from "@/lib/repositories/public-repository";
import { getUpdateNotificationStateOrFallback } from "@/lib/runtime/app-update-notice";
import { getRepositories } from "@/lib/storage/repositories";
import { createDefaultSettings, getSettings } from "@/lib/storage/settings";
import type {
  AppSettings,
  EnrichedRelease,
  FetchError,
  Repository,
} from "@/types";

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "HomePage" });

  let repositories: Repository[] = [];
  let releases: EnrichedRelease[] = [];
  let resolvedError: string | null = null;
  const lastUpdated = new Date();
  let settings: AppSettings;
  const generalError: string | null = null;
  const errorSummary: Map<
    Exclude<FetchError["type"], "not_modified">,
    number
  > | null = null;
  const updateNoticePromise = getUpdateNotificationStateOrFallback();
  const authAccessPromise = getCurrentAuthAccess();
  const initialViewModePromise = cookies().then((cookieStore) =>
    normalizeReleaseViewMode(cookieStore.get(RELEASE_VIEW_MODE_COOKIE)?.value),
  );
  const { isAppriseConfigured } = getNotificationRuntimeConfig();

  try {
    [settings, repositories] = await Promise.all([
      getSettings(),
      getRepositories(),
    ]);
    if (repositories.length > 0) {
      releases = repositories.map(toCachedEnrichedRelease);
      repositories = repositories.map(toPublicRepository);
    }
  } catch (error: unknown) {
    logger
      .withScope("WebServer")
      .error("Failed to load repositories or releases:", error);
    settings = createDefaultSettings();
    resolvedError = t("load_error");
  }

  const [updateNotice, authAccess, initialViewMode] = await Promise.all([
    updateNoticePromise,
    authAccessPromise,
    initialViewModePromise,
  ]);

  return (
    <div className="min-h-screen w-full">
      {authAccess.canMutate && (
        <AutoRefresher intervalMinutes={settings.refreshInterval} />
      )}
      <Header
        locale={locale}
        updateNotice={updateNotice}
        authAccess={authAccess}
      />
      <main className="container mx-auto px-4 py-8 md:px-6">
        <HomePageClient
          repositories={repositories}
          releases={releases}
          settings={settings}
          error={resolvedError}
          generalError={generalError}
          errorSummary={errorSummary}
          lastUpdated={lastUpdated}
          locale={locale}
          initialViewMode={initialViewMode}
          canMutate={authAccess.canMutate}
          isAppriseConfigured={isAppriseConfigured}
        />
      </main>
      <BackToTopButton />
    </div>
  );
}
