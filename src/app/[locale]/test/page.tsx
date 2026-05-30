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
import { getUpdateNotificationState } from "@/lib/runtime/app-update-notice";
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
  const rateLimitResult: RateLimitResult = await getGitHubRateLimit();
  const githubTokenSet = !!process.env.GITHUB_ACCESS_TOKEN;
  const gitlabTokenCheck = await getGitlabTokenCheck();
  const codebergTokenCheck = await getCodebergTokenCheck();
  const notificationConfig = buildNotificationConfig();
  const updateNotice: UpdateNotificationState =
    await getUpdateNotificationState();
  const authAccess = await getCurrentAuthAccess();

  let appriseStatus: AppriseStatus;
  try {
    // This action is now robust and will not throw on network errors.
    appriseStatus = await checkAppriseStatusAction();
  } catch (error) {
    // This is a fallback safety net. The action itself should handle errors.
    logger
      .withScope("WebServer")
      .error("Critical error calling checkAppriseStatusAction:", error);
    appriseStatus = {
      status: "error",
      error: t("apprise_connection_error_fetch"),
    };
  }

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
