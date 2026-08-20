// @vitest-environment jsdom
import { act } from "react";
import ReactDOM from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { SettingsForm } from "@/components/settings-form";
import type { AppSettings } from "@/types";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/app/settings/actions", () => ({
  updateSettingsPatchAction: vi.fn().mockResolvedValue({
    success: true,
    message: { title: "ok", description: "ok" },
  }),
  deleteAllRepositoriesAction: vi.fn().mockResolvedValue({
    success: true,
    message: { title: "ok", description: "ok" },
  }),
}));

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn() }),
}));

describe("SettingsForm offline autosave paused", () => {
  function renderForm(
    isOnline = true,
    isTokenSet = false,
    parallelFetches = 1,
  ) {
    const div = document.createElement("div");
    document.body.appendChild(div);
    const root = ReactDOM.createRoot(div);
    act(() => {
      window.dispatchEvent(new Event(isOnline ? "online" : "offline"));
      root.render(
        <SettingsForm
          currentSettings={
            {
              timeFormat: "24h",
              locale: "en",
              refreshInterval: 10,
              cacheInterval: 5,
              releasesPerPage: 30,
              parallelRepoFetches: parallelFetches,
              releaseChannels: ["stable"],
              preReleaseSubChannels: undefined,
              showAcknowledge: true,
            } satisfies AppSettings
          }
          isAppriseConfigured={true}
          isGithubTokenSet={isTokenSet}
        />,
      );
    });
    return {
      div,
      cleanup: () => {
        act(() => root.unmount());
        div.remove();
      },
    };
  }

  it("does not call updateSettingsAction while offline", async () => {
    vi.useFakeTimers();
    const { div, cleanup } = renderForm(false);
    try {
      const { updateSettingsPatchAction } = await import(
        "@/app/settings/actions"
      );
      // Trigger a change that would normally autosave
      const localeSelect = div.querySelector("#language-select");
      await act(async () => {
        if (localeSelect) {
          localeSelect.dispatchEvent(new Event("change", { bubbles: true }));
        }
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(updateSettingsPatchAction).not.toHaveBeenCalled();
    } finally {
      cleanup();
      vi.useRealTimers();
    }
  });

  it("shows warnings when parallel fetches exceed thresholds without token", async () => {
    const { div, cleanup } = renderForm(true, false, 25);
    try {
      await act(async () => {
        await Promise.resolve();
      });

      const text = div.textContent ?? "";
      expect(text).toContain("parallel_repo_fetches_warning_token");
      expect(text).toContain("parallel_repo_fetches_warning_high");
    } finally {
      cleanup();
    }
  });

  it("renders the security release priority setting", async () => {
    const { div, cleanup } = renderForm(true);
    try {
      expect(div.textContent ?? "").toContain(
        "prioritize_new_security_releases_title",
      );
      expect(div.textContent ?? "").toContain(
        "security_releases_settings_title",
      );
      expect(div.textContent ?? "").toContain(
        "security_highlight_color_yellow",
      );
      expect(div.textContent ?? "").toContain(
        "confirm_security_acknowledge_title",
      );
      expect(div.textContent ?? "").toContain(
        "include_default_security_patterns_title",
      );
    } finally {
      cleanup();
    }
  });

  it("saves a discrete checkbox change immediately and keeps controls enabled", async () => {
    vi.useFakeTimers();
    const { div, cleanup } = renderForm(true);
    try {
      const { updateSettingsPatchAction } = await import(
        "@/app/settings/actions"
      );
      const updateMock = vi.mocked(updateSettingsPatchAction);
      updateMock.mockClear();
      let resolveSave:
        | ((value: {
            success: true;
            message: { title: string; description: string };
          }) => void)
        | undefined;
      updateMock.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
      );

      const label = Array.from(div.querySelectorAll("label")).find(
        (candidate) => candidate.textContent === "show_acknowledge_title",
      );
      const checkbox = label?.htmlFor
        ? document.getElementById(label.htmlFor)
        : null;
      await act(async () => {
        (checkbox as HTMLButtonElement | null)?.click();
        await Promise.resolve();
      });

      expect(updateMock).toHaveBeenCalledOnce();
      const unrelatedLabel = Array.from(div.querySelectorAll("label")).find(
        (candidate) =>
          candidate.textContent === "prioritize_new_security_releases_title",
      );
      const unrelatedCheckbox = unrelatedLabel?.htmlFor
        ? (document.getElementById(
            unrelatedLabel.htmlFor,
          ) as HTMLButtonElement | null)
        : null;
      expect(unrelatedCheckbox?.disabled).toBe(false);

      await act(async () => {
        resolveSave?.({
          success: true,
          message: { title: "ok", description: "ok" },
        });
        await Promise.resolve();
      });
    } finally {
      cleanup();
      vi.useRealTimers();
    }
  });

  it.each([
    ["email", "email_include_release_notes_label", "emailIncludeReleaseNotes"],
    [
      "Apprise",
      "apprise_include_release_notes_label",
      "appriseIncludeReleaseNotes",
    ],
  ] as const)(
    "saves the %s release-note choice independently",
    async (_channel, labelText, settingKey) => {
      vi.useFakeTimers();
      const { div, cleanup } = renderForm(true);
      try {
        const { updateSettingsPatchAction } = await import(
          "@/app/settings/actions"
        );
        const updateMock = vi.mocked(updateSettingsPatchAction);
        updateMock.mockClear();

        const label = Array.from(div.querySelectorAll("label")).find(
          (candidate) => candidate.textContent === labelText,
        );
        const checkbox = label?.htmlFor
          ? document.getElementById(label.htmlFor)
          : null;
        await act(async () => {
          (checkbox as HTMLButtonElement | null)?.click();
          await Promise.resolve();
        });

        expect(updateMock).toHaveBeenCalledWith({ [settingKey]: false });
      } finally {
        cleanup();
        vi.useRealTimers();
      }
    },
  );

  it("saves a text field on blur before the fallback delay", async () => {
    vi.useFakeTimers();
    const { div, cleanup } = renderForm(true);
    try {
      const { updateSettingsPatchAction } = await import(
        "@/app/settings/actions"
      );
      const updateMock = vi.mocked(updateSettingsPatchAction);
      updateMock.mockClear();
      const label = Array.from(div.querySelectorAll("label")).find(
        (candidate) => candidate.textContent === "releases_per_page_label",
      );
      const input = label?.htmlFor
        ? (document.getElementById(label.htmlFor) as HTMLInputElement | null)
        : null;
      expect(input).not.toBeNull();

      await act(async () => {
        if (!input) return;
        const descriptor = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        );
        descriptor?.set?.call(input, "31");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        await Promise.resolve();
      });
      expect(updateMock).not.toHaveBeenCalled();

      await act(async () => {
        input?.focus();
        input?.blur();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(updateMock).toHaveBeenCalledOnce();
    } finally {
      cleanup();
      vi.useRealTimers();
    }
  });
});
