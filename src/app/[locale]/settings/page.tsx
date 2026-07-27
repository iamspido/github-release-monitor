import { getTranslations } from "next-intl/server";
import { Header } from "@/components/header";
import { OfflineInlineNotice } from "@/components/offline-inline-notice";
import { SettingsPageContent } from "@/components/settings-page-content";
import { normalizeLocale } from "@/i18n/config";
import { getCurrentAuthAccess } from "@/lib/auth/access";
import { getAuthFeatureConfig } from "@/lib/auth/config";
import { getNotificationRuntimeConfig } from "@/lib/notifications/config";
import { getUpdateNotificationStateOrFallback } from "@/lib/runtime/app-update-notice";
import { getSettings } from "@/lib/storage/settings";
import type { AppSettings } from "@/types";

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const appLocale = normalizeLocale(locale);
  const t = await getTranslations({
    locale: appLocale,
    namespace: "SettingsPage",
  });
  const { isAppriseConfigured } = getNotificationRuntimeConfig();
  const isGithubTokenSet = !!process.env.GITHUB_ACCESS_TOKEN?.trim();
  const { passkeyEnabled: isPasskeyEnabled, enabledSocialProviders } =
    getAuthFeatureConfig();
  const [currentSettings, updateNotice, authAccess]: [
    AppSettings,
    Awaited<ReturnType<typeof getUpdateNotificationStateOrFallback>>,
    Awaited<ReturnType<typeof getCurrentAuthAccess>>,
  ] = await Promise.all([
    getSettings(),
    getUpdateNotificationStateOrFallback(),
    getCurrentAuthAccess(),
  ]);
  const showInternalAuthSettings =
    authAccess.authenticationMethod !== "External";

  return (
    <div className="min-h-screen w-full bg-background text-foreground">
      <Header
        locale={appLocale}
        updateNotice={updateNotice}
        authAccess={authAccess}
      />
      <main className="container mx-auto px-4 py-8 md:px-6">
        <div className="mx-auto max-w-2xl">
          <h2 className="mb-4 text-3xl font-bold tracking-tight break-words">
            {t("title")}
          </h2>
          <OfflineInlineNotice />
          <div className="h-2" />
          <SettingsPageContent
            currentSettings={currentSettings}
            enabledSocialProviders={enabledSocialProviders}
            isAppriseConfigured={isAppriseConfigured}
            isGithubTokenSet={isGithubTokenSet}
            isPasskeyEnabled={isPasskeyEnabled}
            showInternalAuthSettings={showInternalAuthSettings}
          />
        </div>
      </main>
    </div>
  );
}
