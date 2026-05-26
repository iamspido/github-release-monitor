// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings } from "@/types";

interface MockSelectProps {
  children?: ReactNode;
  disabled?: boolean;
  onValueChange?: (value: string) => void;
  value?: string;
}

interface MockChildrenProps {
  children?: ReactNode;
}

interface MockSelectItemProps extends MockChildrenProps {
  value: string;
}

interface MockTranslate {
  (key: string): string;
  rich: (key: string) => string;
}

vi.mock("next-intl", () => ({
  useTranslations: () => {
    const translate: MockTranslate = Object.assign((key: string) => key, {
      rich: (key: string) => key,
    });
    return translate;
  },
}));

vi.mock("@/app/settings/actions", () => ({
  updateSettingsAction: vi
    .fn()
    .mockResolvedValue({ success: true, message: { title: "ok" } }),
  deleteAllRepositoriesAction: vi
    .fn()
    .mockResolvedValue({ success: true, message: { title: "ok" } }),
}));

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/hooks/use-network", () => ({
  useNetworkStatus: () => ({ isOnline: true }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
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
  SelectTrigger: ({ children }: MockChildrenProps) => <>{children}</>,
  SelectContent: ({ children }: MockChildrenProps) => <>{children}</>,
  SelectItem: ({ children, value }: MockSelectItemProps) => (
    <option value={value}>{children}</option>
  ),
  SelectValue: () => null,
}));

import { SettingsForm } from "@/components/settings-form";

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const baseSettings: AppSettings = {
  timeFormat: "24h",
  locale: "en",
  refreshInterval: 10,
  cacheInterval: 5,
  releasesPerPage: 30,
  parallelRepoFetches: 5,
  releaseChannels: ["stable"],
};

function getSelects(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll("select"),
  ) as HTMLSelectElement[];
}

function findSelectWithOptions(container: HTMLElement, values: string[]) {
  return getSelects(container).find((select) => {
    const optionValues = Array.from(select.options).map(
      (option) => option.value,
    );
    return values.every((value) => optionValues.includes(value));
  });
}

function setSelectValue(select: HTMLSelectElement, value: string) {
  select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("SettingsForm cron defaults", () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  function renderForm(settings: Partial<AppSettings> = {}) {
    act(() => {
      root.render(
        <SettingsForm
          currentSettings={{ ...baseSettings, ...settings }}
          isAppriseConfigured={false}
          isGithubTokenSet={false}
        />,
      );
    });
  }

  it("uses 08:00 when switching global automation to a schedule", () => {
    renderForm();

    const automationSelect = findSelectWithOptions(container, [
      "interval",
      "cron",
    ]);
    expect(automationSelect).toBeTruthy();

    act(() => {
      setSelectValue(automationSelect as HTMLSelectElement, "cron");
    });

    const hourSelect = getSelects(container).find((select) => {
      const values = Array.from(select.options).map((option) => option.value);
      return values.length === 24 && values[0] === "00" && values[23] === "23";
    });
    const minuteSelect = getSelects(container).find((select) => {
      const values = Array.from(select.options).map((option) => option.value);
      return values.length === 60 && values[0] === "00" && values[59] === "59";
    });

    expect(hourSelect?.value).toBe("08");
    expect(minuteSelect?.value).toBe("00");
  });

  it("uses 0 8 * * * as the custom cron placeholder", () => {
    renderForm();

    const automationSelect = findSelectWithOptions(container, [
      "interval",
      "cron",
    ]);
    expect(automationSelect).toBeTruthy();

    act(() => {
      setSelectValue(automationSelect as HTMLSelectElement, "cron");
    });

    const presetSelect = findSelectWithOptions(container, [
      "daily",
      "weekdays",
      "weekly",
      "custom",
    ]);
    expect(presetSelect).toBeTruthy();

    act(() => {
      setSelectValue(presetSelect as HTMLSelectElement, "custom");
    });

    const cronInput = Array.from(container.querySelectorAll("input")).find(
      (input) => input.placeholder === "0 8 * * *",
    );
    expect(cronInput).toBeTruthy();
  });
});
