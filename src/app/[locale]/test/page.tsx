import { getTranslations } from "next-intl/server";
import { checkAppriseStatusAction } from "@/app/actions";
import { Header } from "@/components/header";
import { TestPageClient } from "@/components/test-page-client";
import { normalizeLocale } from "@/i18n/config";
import { getCurrentAuthAccess } from "@/lib/auth/access";
import { buildNotificationConfig } from "@/lib/diagnostics/notification-config";
import {
  getCodebergTokenCheck,
  getForgejoTokenChecks,
  getGitHubRateLimit,
  getGitlabTokenCheck,
} from "@/lib/diagnostics/provider-checks";
import { logger } from "@/lib/logger";
import { getUpdateNotificationStateOrFallback } from "@/lib/runtime/app-update-notice";
import { getSettings } from "@/lib/storage/settings";
import type {
  AppriseStatus,
  RateLimitResult,
  UpdateNotificationState,
} from "@/types";

export default async function TestPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const appLocale = normalizeLocale(locale);
  const t = await getTranslations({
    locale: appLocale,
    namespace: "TestPage",
  });
  const githubTokenSet = !!process.env.GITHUB_ACCESS_TOKEN;
  const notificationConfig = buildNotificationConfig();
  const appriseStatusPromise: Promise<AppriseStatus> =
    checkAppriseStatusAction().catch((error) => {
      logger
        .withScope("WebServer")
        .error("Critical error calling checkAppriseStatusAction:", error);
      return {
        status: "error",
        error: t("apprise_connection_error_fetch"),
      };
    });
  const [
    rateLimitResult,
    gitlabTokenCheck,
    codebergTokenCheck,
    forgejoTokenChecks,
    updateNotice,
    authAccess,
    appriseStatus,
    settings,
  ]: [
    RateLimitResult,
    Awaited<ReturnType<typeof getGitlabTokenCheck>>,
    Awaited<ReturnType<typeof getCodebergTokenCheck>>,
    Awaited<ReturnType<typeof getForgejoTokenChecks>>,
    UpdateNotificationState,
    Awaited<ReturnType<typeof getCurrentAuthAccess>>,
    AppriseStatus,
    Awaited<ReturnType<typeof getSettings>>,
  ] = await Promise.all([
    getGitHubRateLimit(),
    getGitlabTokenCheck(),
    getCodebergTokenCheck(),
    getForgejoTokenChecks(),
    getUpdateNotificationStateOrFallback(),
    getCurrentAuthAccess(),
    appriseStatusPromise,
    getSettings(),
  ]);

  return (
    <div className="min-h-screen w-full bg-background text-foreground">
      <Header
        locale={appLocale}
        updateNotice={updateNotice}
        authAccess={authAccess}
      />
      <main className="container mx-auto px-4 py-8 md:px-6">
        <h2 className="mb-8 text-3xl font-bold tracking-tight break-words">
          {t("title")}
        </h2>
        <TestPageClient
          rateLimitResult={rateLimitResult}
          isTokenSet={githubTokenSet}
          gitlabTokenCheck={gitlabTokenCheck}
          codebergTokenCheck={codebergTokenCheck}
          forgejoTokenChecks={forgejoTokenChecks}
          notificationConfig={notificationConfig}
          appriseStatus={appriseStatus}
          updateNotice={updateNotice}
          timeFormat={settings.timeFormat}
        />
      </main>
    </div>
  );
}
