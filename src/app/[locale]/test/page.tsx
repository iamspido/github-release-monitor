import { getTranslations } from "next-intl/server";
import { checkAppriseStatusAction } from "@/app/actions";
import { Header } from "@/components/header";
import { TestPageClient } from "@/components/test-page-client";
import { getCurrentAuthAccess } from "@/lib/auth/access";
import { buildNotificationConfig } from "@/lib/diagnostics/notification-config";
import {
  getCodebergTokenCheck,
  getGitHubRateLimit,
  getGitlabTokenCheck,
} from "@/lib/diagnostics/provider-checks";
import { logger } from "@/lib/logger";
import { getUpdateNotificationStateOrFallback } from "@/lib/runtime/app-update-notice";
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
  const t = await getTranslations({ locale: locale, namespace: "TestPage" });
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
    updateNotice,
    authAccess,
    appriseStatus,
  ]: [
    RateLimitResult,
    Awaited<ReturnType<typeof getGitlabTokenCheck>>,
    Awaited<ReturnType<typeof getCodebergTokenCheck>>,
    UpdateNotificationState,
    Awaited<ReturnType<typeof getCurrentAuthAccess>>,
    AppriseStatus,
  ] = await Promise.all([
    getGitHubRateLimit(),
    getGitlabTokenCheck(),
    getCodebergTokenCheck(),
    getUpdateNotificationStateOrFallback(),
    getCurrentAuthAccess(),
    appriseStatusPromise,
  ]);

  return (
    <div className="min-h-screen w-full bg-background text-foreground">
      <Header
        locale={locale}
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
          notificationConfig={notificationConfig}
          appriseStatus={appriseStatus}
          updateNotice={updateNotice}
        />
      </main>
    </div>
  );
}
