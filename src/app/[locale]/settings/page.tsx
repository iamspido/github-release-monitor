import { getTranslations } from "next-intl/server";
import { getUpdateNotificationState } from "@/app/actions";
import { Header } from "@/components/header";
import { OfflineInlineNotice } from "@/components/offline-inline-notice";
import { SettingsForm } from "@/components/settings-form";
import { getSettings } from "@/lib/settings-storage";
import type { AppSettings } from "@/types";

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({
    locale: locale,
    namespace: "SettingsPage",
  });
  const currentSettings: AppSettings = await getSettings();
  const isAppriseConfigured = !!process.env.APPRISE_URL;
  const isGithubTokenSet = !!process.env.GITHUB_ACCESS_TOKEN?.trim();
  const updateNotice = await getUpdateNotificationState();

  return (
    <div className="min-h-screen w-full bg-background text-foreground">
      <Header locale={locale} updateNotice={updateNotice} />
      <main className="container mx-auto px-4 py-8 md:px-6">
        <div className="mx-auto max-w-2xl">
          <h2 className="mb-4 text-3xl font-bold tracking-tight break-words">
            {t("title")}
          </h2>
          <OfflineInlineNotice />
          <div className="h-2" />
          <SettingsForm
            currentSettings={currentSettings}
            isAppriseConfigured={isAppriseConfigured}
            isGithubTokenSet={isGithubTokenSet}
          />
        </div>
      </main>
    </div>
  );
}
