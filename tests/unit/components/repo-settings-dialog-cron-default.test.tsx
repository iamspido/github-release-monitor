// @vitest-environment jsdom
import { act, type HTMLAttributes, type ReactNode } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings, Repository } from "@/types";

interface MockSelectProps {
  children?: ReactNode;
  disabled?: boolean;
  onValueChange?: (value: string) => void;
  value?: string;
}

interface MockChildrenProps {
  children?: ReactNode;
}

type MockDivProps = HTMLAttributes<HTMLDivElement> & MockChildrenProps;

interface MockSelectItemProps extends MockChildrenProps {
  value: string;
}

interface MockTranslate {
  (key: string): string;
  rich: (key: string) => string;
}

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const actionMocks = vi.hoisted(() => ({
  refreshSingleRepositoryAction: vi.fn().mockResolvedValue({}),
  updateRepositorySettingsAction: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => {
    const translate: MockTranslate = Object.assign((key: string) => key, {
      rich: (key: string) => key,
    });
    return translate;
  },
}));

vi.mock("@/app/actions", () => ({
  updateRepositorySettingsAction: actionMocks.updateRepositorySettingsAction,
  refreshSingleRepositoryAction: actionMocks.refreshSingleRepositoryAction,
}));

vi.mock("@/hooks/use-network", () => ({
  useNetworkStatus: () => ({ isOnline: true }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: vi.fn(),
    dismiss: vi.fn(),
    toasts: [],
  }),
  toast: vi.fn(),
}));

vi.mock("@/components/ui/dialog", () => {
  const passthrough = ({ children, ...props }: MockDivProps) => (
    <div {...props}>{children}</div>
  );
  return {
    Dialog: passthrough,
    DialogContent: passthrough,
    DialogHeader: passthrough,
    DialogTitle: passthrough,
    DialogDescription: passthrough,
    DialogFooter: passthrough,
    DialogTrigger: passthrough,
  };
});

vi.mock("@/components/ui/alert-dialog", () => {
  const passthrough = ({ children, ...props }: MockDivProps) => (
    <div {...props}>{children}</div>
  );
  const passthroughChild = ({ children }: MockChildrenProps) => <>{children}</>;
  return {
    AlertDialog: passthrough,
    AlertDialogTrigger: passthroughChild,
    AlertDialogContent: passthrough,
    AlertDialogHeader: passthrough,
    AlertDialogTitle: passthrough,
    AlertDialogDescription: passthrough,
    AlertDialogFooter: passthrough,
    AlertDialogAction: passthrough,
    AlertDialogCancel: passthrough,
  };
});

vi.mock("@/components/ui/tooltip", () => {
  const passthrough = ({ children, ...props }: MockDivProps) => (
    <div {...props}>{children}</div>
  );
  const passthroughChild = ({ children }: MockChildrenProps) => <>{children}</>;
  return {
    TooltipProvider: passthroughChild,
    Tooltip: passthroughChild,
    TooltipTrigger: passthroughChild,
    TooltipContent: passthrough,
  };
});

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

import { RepoSettingsDialog } from "@/components/repo-settings-dialog";

const globalSettings: AppSettings = {
  timeFormat: "24h",
  locale: "en",
  refreshInterval: 10,
  cacheInterval: 5,
  releasesPerPage: 30,
  parallelRepoFetches: 5,
  releaseChannels: ["stable"],
};

const emptyRepoSettings: Pick<
  Repository,
  | "releaseChannels"
  | "preReleaseSubChannels"
  | "releasesPerPage"
  | "refreshInterval"
  | "cacheInterval"
  | "backgroundCheckCron"
  | "includeRegex"
  | "excludeRegex"
  | "appriseTags"
  | "appriseFormat"
> = {
  releaseChannels: [],
  preReleaseSubChannels: [],
  releasesPerPage: null,
  refreshInterval: null,
  cacheInterval: null,
  backgroundCheckCron: null,
  includeRegex: undefined,
  excludeRegex: undefined,
  appriseTags: undefined,
  appriseFormat: undefined,
};

const repoSettingsWithAutomationOverrides: typeof emptyRepoSettings = {
  ...emptyRepoSettings,
  refreshInterval: 120,
  cacheInterval: 0,
  backgroundCheckCron: "0 21 * * *",
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

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("RepoSettingsDialog cron defaults", () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    vi.useFakeTimers();
    actionMocks.updateRepositorySettingsAction.mockClear();
    actionMocks.updateRepositorySettingsAction.mockResolvedValue({
      success: true,
    });
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

  function renderDialog(repoSettings = emptyRepoSettings) {
    act(() => {
      root.render(
        <RepoSettingsDialog
          isOpen
          setIsOpen={() => {}}
          repoId="owner/repo"
          currentRepoSettings={repoSettings}
          globalSettings={globalSettings}
        />,
      );
    });
  }

  it("uses 08:00 when switching a repository override to schedule mode", () => {
    renderDialog();

    const automationSelect = findSelectWithOptions(container, [
      "global",
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

  it("resets repository automation overrides to global settings", async () => {
    renderDialog(repoSettingsWithAutomationOverrides);

    const automationHeading = Array.from(container.querySelectorAll("h4")).find(
      (heading) => heading.textContent === "automation_title",
    );
    const automationSection = automationHeading?.parentElement?.parentElement;
    const resetButton = automationSection?.querySelector("button");

    expect(resetButton).toBeTruthy();

    act(() => {
      resetButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
    await flushEffects();

    await act(async () => {
      vi.advanceTimersByTime(1500);
      await Promise.resolve();
      await Promise.resolve();
    });
    await flushEffects();

    expect(actionMocks.updateRepositorySettingsAction).toHaveBeenCalledWith(
      "owner/repo",
      expect.objectContaining({
        refreshInterval: null,
        cacheInterval: null,
        backgroundCheckCron: undefined,
      }),
    );
  });
});
