// @vitest-environment jsdom
import { act } from "react";
import ReactDOM from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { TimeFormat } from "@/types";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/components/settings-form", () => ({
  SettingsForm: ({
    onTimeFormatChange,
  }: {
    onTimeFormatChange?: (value: TimeFormat) => void;
  }) => (
    <button type="button" onClick={() => onTimeFormatChange?.("12h")}>
      switch format
    </button>
  ),
  SettingsDangerZoneCard: () => null,
}));

vi.mock("@/components/passkey-settings-card", () => ({
  PasskeySettingsCard: ({ timeFormat }: { timeFormat: TimeFormat }) => (
    <span data-testid="passkey-time-format">{timeFormat}</span>
  ),
}));

vi.mock("@/components/account-credentials-settings-card", () => ({
  AccountCredentialsSettingsCard: () => null,
}));
vi.mock("@/components/two-factor-settings-card", () => ({
  TwoFactorSettingsCard: () => null,
}));
vi.mock("@/components/social-accounts-settings-card", () => ({
  SocialAccountsSettingsCard: () => null,
}));

import { SettingsPageContent } from "@/components/settings-page-content";
import type { AppSettings } from "@/types";

describe("SettingsPageContent", () => {
  it("updates passkey timestamps when the time format setting changes", async () => {
    const container = document.createElement("div");
    const root = ReactDOM.createRoot(container);

    try {
      await act(async () => {
        root.render(
          <SettingsPageContent
            currentSettings={{ timeFormat: "24h" } as AppSettings}
            enabledSocialProviders={[]}
            isAppriseConfigured={false}
            isGithubTokenSet={false}
            isPasskeyEnabled
            showInternalAuthSettings
          />,
        );
      });
      expect(
        container.querySelector('[data-testid="passkey-time-format"]')
          ?.textContent,
      ).toBe("24h");

      await act(async () => {
        (
          container.querySelector("button") as HTMLButtonElement | null
        )?.click();
      });
      expect(
        container.querySelector('[data-testid="passkey-time-format"]')
          ?.textContent,
      ).toBe("12h");
    } finally {
      act(() => root.unmount());
    }
  });
});
