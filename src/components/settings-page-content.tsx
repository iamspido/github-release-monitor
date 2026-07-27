"use client";

import * as React from "react";
import { AccountCredentialsSettingsCard } from "@/components/account-credentials-settings-card";
import { PasskeySettingsCard } from "@/components/passkey-settings-card";
import {
  SettingsDangerZoneCard,
  SettingsForm,
} from "@/components/settings-form";
import { SocialAccountsSettingsCard } from "@/components/social-accounts-settings-card";
import { TwoFactorSettingsCard } from "@/components/two-factor-settings-card";
import type { AuthSocialProvider } from "@/lib/auth/config";
import type { AppSettings } from "@/types";

export function SettingsPageContent({
  currentSettings,
  enabledSocialProviders,
  isAppriseConfigured,
  isGithubTokenSet,
  isPasskeyEnabled,
  showInternalAuthSettings,
}: {
  currentSettings: AppSettings;
  enabledSocialProviders: AuthSocialProvider[];
  isAppriseConfigured: boolean;
  isGithubTokenSet: boolean;
  isPasskeyEnabled: boolean;
  showInternalAuthSettings: boolean;
}) {
  const [timeFormat, setTimeFormat] = React.useState(
    currentSettings.timeFormat,
  );

  return (
    <>
      <SettingsForm
        currentSettings={currentSettings}
        isAppriseConfigured={isAppriseConfigured}
        isGithubTokenSet={isGithubTokenSet}
        onTimeFormatChange={setTimeFormat}
      />
      {showInternalAuthSettings && (
        <>
          <AccountCredentialsSettingsCard />
          <TwoFactorSettingsCard />
          {isPasskeyEnabled && <PasskeySettingsCard timeFormat={timeFormat} />}
          {enabledSocialProviders.length > 0 && (
            <SocialAccountsSettingsCard
              enabledSocialProviders={enabledSocialProviders}
            />
          )}
        </>
      )}
      <SettingsDangerZoneCard />
    </>
  );
}
