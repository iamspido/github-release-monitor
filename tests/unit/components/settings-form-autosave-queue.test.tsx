// @vitest-environment jsdom
import { act, type ReactNode, StrictMode } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings } from "@/types";

interface MockSelectProps {
  children?: ReactNode;
  disabled?: boolean;
  onValueChange?: (value: string) => void;
  value?: string;
}

interface MockSelectItemProps {
  children?: ReactNode;
  value: string;
}

const updateSettingsMock = vi.fn();
const routerPushMock = vi.fn();
const toastMock = vi.fn();
const translateMock = (key: string) => key;
let networkState = { isOnline: true };

vi.mock("next-intl", () => ({
  useTranslations: () => translateMock,
}));

vi.mock("@/app/settings/actions", () => ({
  updateSettingsPatchAction: (...args: unknown[]) =>
    updateSettingsMock(...args),
  deleteAllRepositoriesAction: vi.fn(),
}));

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/settings",
  useRouter: () => ({ push: routerPushMock }),
}));

vi.mock("@/hooks/use-network", () => ({
  useNetworkStatus: () => networkState,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children, disabled, onValueChange, value }: MockSelectProps) => (
    <select
      disabled={disabled}
      value={value}
      onChange={(event) => onValueChange?.(event.currentTarget.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
  SelectContent: ({ children }: { children?: ReactNode }) => <>{children}</>,
  SelectItem: ({ children, value }: MockSelectItemProps) => (
    <option value={value}>{children}</option>
  ),
  SelectValue: () => null,
}));

import { SettingsForm } from "@/components/settings-form";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const settings: AppSettings = {
  timeFormat: "24h",
  locale: "en",
  refreshInterval: 10,
  cacheInterval: 5,
  releasesPerPage: 30,
  parallelRepoFetches: 1,
  releaseChannels: ["stable"],
};

function setInputValue(input: HTMLInputElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  );
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("SettingsForm autosave queue", () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    vi.useFakeTimers();
    updateSettingsMock.mockReset();
    routerPushMock.mockReset();
    networkState = { isOnline: true };
    sessionStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it("waits for the latest queued snapshot before locale navigation", async () => {
    const resolvers: Array<
      (value: {
        success: true;
        message: { title: string; description: string };
      }) => void
    > = [];
    updateSettingsMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    );

    await act(async () => {
      root.render(
        <SettingsForm
          currentSettings={settings}
          isAppriseConfigured
          isGithubTokenSet
        />,
      );
    });

    const languageSelect = Array.from(
      container.querySelectorAll("select"),
    ).find((select) =>
      Array.from(select.options).some((option) => option.value === "de"),
    );
    expect(languageSelect).toBeTruthy();

    await act(async () => {
      if (!languageSelect) return;
      languageSelect.value = "de";
      languageSelect.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });
    expect(updateSettingsMock).toHaveBeenCalledOnce();

    const releasesLabel = Array.from(container.querySelectorAll("label")).find(
      (label) => label.textContent === "releases_per_page_label",
    );
    const releasesInput = releasesLabel?.htmlFor
      ? (document.getElementById(releasesLabel.htmlFor) as HTMLInputElement)
      : null;
    expect(releasesInput).not.toBeNull();
    await act(async () => {
      if (releasesInput) setInputValue(releasesInput, "31");
    });

    await act(async () => {
      resolvers[0]?.({
        success: true,
        message: { title: "ok", description: "ok" },
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(routerPushMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(750);
      await Promise.resolve();
    });
    expect(updateSettingsMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolvers[1]?.({
        success: true,
        message: { title: "ok", description: "ok" },
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(routerPushMock).toHaveBeenCalledWith("/settings", { locale: "de" });
  });

  it("drops a queued snapshot when the draft returns to the in-flight snapshot", async () => {
    let resolveLocaleSave:
      | ((value: {
          success: true;
          message: { title: string; description: string };
        }) => void)
      | undefined;
    updateSettingsMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveLocaleSave = resolve;
      }),
    );

    await act(async () => {
      root.render(
        <SettingsForm
          currentSettings={settings}
          isAppriseConfigured
          isGithubTokenSet
        />,
      );
    });

    const languageSelect = Array.from(
      container.querySelectorAll("select"),
    ).find((select) =>
      Array.from(select.options).some((option) => option.value === "de"),
    );
    const releasesLabel = Array.from(container.querySelectorAll("label")).find(
      (label) => label.textContent === "releases_per_page_label",
    );
    const releasesInput = releasesLabel?.htmlFor
      ? (document.getElementById(releasesLabel.htmlFor) as HTMLInputElement)
      : null;
    expect(languageSelect).toBeTruthy();
    expect(releasesInput).not.toBeNull();

    await act(async () => {
      if (!languageSelect) return;
      languageSelect.value = "de";
      languageSelect.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });
    expect(updateSettingsMock).toHaveBeenCalledOnce();

    await act(async () => {
      if (!releasesInput) return;
      setInputValue(releasesInput, "31");
      await Promise.resolve();
    });
    await act(async () => {
      if (!releasesInput) return;
      setInputValue(releasesInput, "30");
      await Promise.resolve();
    });

    await act(async () => {
      resolveLocaleSave?.({
        success: true,
        message: { title: "ok", description: "ok" },
      });
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(updateSettingsMock).toHaveBeenCalledOnce();
    expect(routerPushMock).toHaveBeenCalledWith("/settings", { locale: "de" });
  });

  it("does not autosave normalized defaults during Strict Mode replay", async () => {
    await act(async () => {
      root.render(
        <StrictMode>
          <SettingsForm
            currentSettings={settings}
            isAppriseConfigured
            isGithubTokenSet
          />
        </StrictMode>,
      );
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(updateSettingsMock).not.toHaveBeenCalled();
  });

  it("does not navigate for a locale save while the current draft is invalid", async () => {
    let resolveLocaleSave:
      | ((value: {
          success: true;
          message: { title: string; description: string };
        }) => void)
      | undefined;
    updateSettingsMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveLocaleSave = resolve;
      }),
    );

    await act(async () => {
      root.render(
        <SettingsForm
          currentSettings={settings}
          isAppriseConfigured
          isGithubTokenSet
        />,
      );
    });

    const languageSelect = Array.from(
      container.querySelectorAll("select"),
    ).find((select) =>
      Array.from(select.options).some((option) => option.value === "de"),
    );
    const releasesLabel = Array.from(container.querySelectorAll("label")).find(
      (label) => label.textContent === "releases_per_page_label",
    );
    const releasesInput = releasesLabel?.htmlFor
      ? (document.getElementById(releasesLabel.htmlFor) as HTMLInputElement)
      : null;
    expect(languageSelect).toBeTruthy();
    expect(releasesInput).not.toBeNull();

    await act(async () => {
      if (!languageSelect) return;
      languageSelect.value = "de";
      languageSelect.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => {
      if (releasesInput) setInputValue(releasesInput, "");
    });

    await act(async () => {
      resolveLocaleSave?.({
        success: true,
        message: { title: "ok", description: "ok" },
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(routerPushMock).not.toHaveBeenCalled();

    await act(async () => {
      if (releasesInput) setInputValue(releasesInput, "30");
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(routerPushMock).toHaveBeenCalledWith("/settings", { locale: "de" });
  });

  it("queues the latest transition-time draft while offline", async () => {
    updateSettingsMock.mockResolvedValue({
      success: true,
      message: { title: "ok", description: "ok" },
    });
    const render = () =>
      root.render(
        <SettingsForm
          currentSettings={settings}
          isAppriseConfigured
          isGithubTokenSet
        />,
      );

    await act(async () => render());
    const releasesLabel = Array.from(container.querySelectorAll("label")).find(
      (label) => label.textContent === "releases_per_page_label",
    );
    const releasesInput = releasesLabel?.htmlFor
      ? (document.getElementById(releasesLabel.htmlFor) as HTMLInputElement)
      : null;
    expect(releasesInput).not.toBeNull();

    await act(async () => {
      if (releasesInput) setInputValue(releasesInput, "31");
      networkState = { isOnline: false };
      render();
      if (releasesInput) setInputValue(releasesInput, "32");
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(updateSettingsMock).not.toHaveBeenCalled();

    await act(async () => {
      networkState = { isOnline: true };
      render();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(updateSettingsMock).toHaveBeenCalledOnce();
    expect(updateSettingsMock).toHaveBeenCalledWith(
      expect.objectContaining({ releasesPerPage: 32 }),
    );
  });
});
