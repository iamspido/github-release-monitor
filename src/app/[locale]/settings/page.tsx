import { getTranslations } from "next-intl/server";
import { getUpdateNotificationState } from "@/app/actions";
import { AccountCredentialsSettingsCard } from "@/components/account-credentials-settings-card";
import { Header } from "@/components/header";
import { OfflineInlineNotice } from "@/components/offline-inline-notice";
import { PasskeySettingsCard } from "@/components/passkey-settings-card";
import {
  SettingsDangerZoneCard,
  SettingsForm,
} from "@/components/settings-form";
import { SocialAccountsSettingsCard } from "@/components/social-accounts-settings-card";
import { TwoFactorSettingsCard } from "@/components/two-factor-settings-card";
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
  const isPasskeyEnabled = process.env.AUTH_ENABLE_PASSKEY !== "false";
  const enabledSocialProviders: Array<"github" | "google"> = [];
  if (
    process.env.AUTH_GITHUB_CLIENT_ID?.trim() &&
    process.env.AUTH_GITHUB_CLIENT_SECRET?.trim()
  ) {
    enabledSocialProviders.push("github");
  }
  if (
    process.env.AUTH_GOOGLE_CLIENT_ID?.trim() &&
    process.env.AUTH_GOOGLE_CLIENT_SECRET?.trim()
  ) {
    enabledSocialProviders.push("google");
  }
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
          <AccountCredentialsSettingsCard />
          <TwoFactorSettingsCard />
          {isPasskeyEnabled && <PasskeySettingsCard />}
          {enabledSocialProviders.length > 0 && (
            <SocialAccountsSettingsCard
              enabledSocialProviders={enabledSocialProviders}
            />
          )}
          <SettingsDangerZoneCard />
        </div>
      </main>
    </div>
  );
}
