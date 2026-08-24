// @vitest-environment jsdom
import type React from "react";
import { act } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, beforeAll, beforeEach, vi } from "vitest";
import type { AppSettings, Repository } from "@/types";

type RichValues = Record<string, (() => React.ReactNode) | string>;
type TranslationFn = ((
  key: string,
  values?: Record<string, unknown>,
) => string) & {
  rich: (key: string, values?: RichValues) => React.ReactNode;
};
type PassthroughProps = React.HTMLAttributes<HTMLDivElement> & {
  children?: React.ReactNode;
};
type DialogContentProps = PassthroughProps & {
  onOpenAutoFocus?: (event: Event) => void;
};
type UpdateRepositorySettingsAction =
  typeof import("@/app/actions").updateRepositorySettingsAction;

const translationMap: Record<string, Record<string, string>> = {
  RepoSettingsDialog: {
    title: "Repository settings",
    display_section_title: "Display",
    display_section_description: "Customize display",
    display_name_label: "Display name (optional)",
    display_name_hint: "Overrides the automatic heading",
    display_name_error_invalid: "Enter a valid display name",
    pin_to_top_label: "Pin to top",
    pin_to_top_description: "Show before unpinned repositories",
    close_validation_error: "Fix invalid settings before closing",
    autosave_waiting: "Waiting to save…",
    autosave_saving: "Saving…",
    autosave_success_short: "Saved",
    autosave_error: "Save failed",
    autosave_paused_offline: "Offline – saving paused",
    toast_error_title: "Save error",
    reset_to_global_button: "Reset filters",
    reset_to_global_tooltip: "Reset to global",
    release_selection_reset_button: "Use global release selection setting",
    version_tag_pattern_label: "Version tag pattern (optional)",
    version_tag_pattern_placeholder: "Version pattern",
    version_tag_pattern_hint: "Use named version and revision groups",
    version_tag_pattern_reset_button: "Clear version tag pattern",
    version_tag_pattern_error_invalid: "Invalid version pattern",
    version_tag_pattern_error_missing_version_group:
      "Missing named version group",
    reset_all_button_text: "Reset all",
    reset_all_dialog_title: "Reset all settings",
    reset_all_dialog_description: "Reset every override",
    reset_all_confirm_button: "Confirm reset all",
    releases_per_page_label_repo: "Releases per page",
    releases_per_page_hint_global: "Using global value",
    releases_per_page_hint_individual: "Using custom value",
    regex_filter_title: "Regex filter",
    channels_hint_global: "Global channels",
    channels_hint_individual: "Individual channels",
    automation_title: "Automation",
    automation_description: "Configure automation",
    automation_mode_label: "Mode",
    automation_mode_global: "Global interval",
    automation_mode_global_cron: "Global schedule",
    automation_mode_interval: "Custom interval",
    automation_mode_cron: "Schedule",
    custom_cache_label: "Custom cache",
    custom_cache_description: "Global cache duration",
    custom_cache_hint: "Set 0 to disable cache",
    tags_move_left_aria: "Move tag left",
    tags_move_right_aria: "Move tag right",
    tags_create_option: "Add new tag",
  },
  SettingsForm: {
    autosave_success: "All changes saved",
    offline_notice:
      "Offline – this dialog is read-only. Changes will not be saved until you're back online.",
    release_channel_title: "Channels",
    release_channel_description_repo: "Pick channels",
    release_channel_stable: "Stable",
    release_channel_prerelease: "Prerelease",
    release_channel_draft: "Draft",
    prerelease_subtype_description: "Prerelease tags",
    release_selection_strategy_label: "Release selection",
    regex_filter_description_repo: "Filter releases",
    include_regex_label: "Include regex",
    exclude_regex_label: "Exclude regex",
    regex_placeholder: "Regex…",
    regex_error_invalid: "Invalid regular expression.",
  },
};

let mockedLocale = "en";

export function setMockedLocale(locale: string) {
  mockedLocale = locale;
}

vi.mock("next-intl", () => ({
  useLocale: () => mockedLocale,
  useTranslations: (namespace: string) => {
    const dict = translationMap[namespace] ?? {};
    const translate = ((key: string) =>
      dict[key] ?? `${namespace}.${key}`) as TranslationFn;
    translate.rich = (key: string, values?: RichValues) => {
      const message = dict[key];
      if (!message) return `${namespace}.${key}`;
      if (!values) return message;
      const repoId = values.repoId;
      return message.replace(
        "{repoId}",
        typeof repoId === "function" ? String(repoId()) : "",
      );
    };
    return translate;
  },
}));

let networkState = { isOnline: true };

export function setNetworkOnline(isOnline: boolean) {
  networkState = { isOnline };
}

vi.mock("@/hooks/use-network", () => ({
  useNetworkStatus: () => networkState,
}));

export const toastSpy = vi.fn();

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toasts: [],
    toast: toastSpy,
    dismiss: vi.fn(),
  }),
  toast: vi.fn(),
}));

vi.mock("@/components/ui/dialog", () => {
  const passthrough = ({ children, ...rest }: PassthroughProps) => (
    <div {...rest}>{children}</div>
  );
  return {
    Dialog: ({
      children,
      onOpenChange,
    }: {
      children: React.ReactNode;
      onOpenChange?: (open: boolean) => void;
    }) => (
      <div>
        <button
          type="button"
          data-testid="close-repository-settings"
          onClick={() => onOpenChange?.(false)}
        >
          Close repository settings
        </button>
        {children}
      </div>
    ),
    DialogContent: ({
      onOpenAutoFocus: _onOpenAutoFocus,
      ...props
    }: DialogContentProps) => passthrough(props),
    DialogHeader: passthrough,
    DialogTitle: passthrough,
    DialogDescription: passthrough,
    DialogFooter: passthrough,
    DialogTrigger: passthrough,
  };
});

export const updateSettingsMock = vi.fn();
export const refreshRepositoryMock = vi.fn();

vi.mock("@/app/actions", async () => {
  const actual = await vi.importActual("@/app/actions");
  const updateRepositorySettingsAction: UpdateRepositorySettingsAction = (
    repoId,
    settings,
  ) => updateSettingsMock(repoId, settings);
  return {
    ...actual,
    updateRepositorySettingsAction: vi.fn(updateRepositorySettingsAction),
    refreshSingleRepositoryAction: (...args: unknown[]) =>
      refreshRepositoryMock(...args),
  };
});

export const baseSettings: AppSettings = {
  timeFormat: "24h",
  locale: "en",
  refreshInterval: 5,
  cacheInterval: 5,
  releasesPerPage: 10,
  parallelRepoFetches: 3,
  releaseChannels: ["stable"],
};

export const emptyRepoSettings: Pick<
  Repository,
  | "releaseChannels"
  | "preReleaseSubChannels"
  | "releaseSelectionStrategy"
  | "versionTagPattern"
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
  releaseSelectionStrategy: undefined,
  versionTagPattern: undefined,
  releasesPerPage: null,
  refreshInterval: null,
  cacheInterval: null,
  backgroundCheckCron: null,
  includeRegex: undefined,
  excludeRegex: undefined,
  appriseTags: undefined,
  appriseFormat: undefined,
};

let RepoSettingsDialogComponent: typeof import("@/components/repo-settings-dialog").RepoSettingsDialog;

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

export let container: HTMLDivElement;
let root: ReactDOM.Root;

beforeAll(async () => {
  const mod = await import("@/components/repo-settings-dialog");
  RepoSettingsDialogComponent = mod.RepoSettingsDialog;
});

beforeEach(() => {
  vi.useFakeTimers();
  mockedLocale = "en";
  networkState = { isOnline: true };
  toastSpy.mockClear();
  updateSettingsMock.mockReset();
  updateSettingsMock.mockResolvedValue({ success: true });
  refreshRepositoryMock.mockReset();
  refreshRepositoryMock.mockResolvedValue({});
  container = document.createElement("div");
  document.body.appendChild(container);
  root = ReactDOM.createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
    await vi.runOnlyPendingTimersAsync();
  });
  vi.useRealTimers();
  container.remove();
});

export function renderDialog(
  props?: Partial<
    React.ComponentProps<
      typeof import("@/components/repo-settings-dialog").RepoSettingsDialog
    >
  >,
) {
  act(() => {
    root.render(
      <RepoSettingsDialogComponent
        isOpen
        setIsOpen={() => {}}
        repoId="owner/repo"
        currentRepoSettings={emptyRepoSettings}
        globalSettings={baseSettings}
        {...props}
      />,
    );
  });
}

export async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

export function setInputValue(input: HTMLInputElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  );
  if (descriptor?.set) {
    descriptor.set.call(input, value);
  } else {
    input.value = value;
  }
  input.dispatchEvent(
    new Event("input", { bubbles: true, cancelable: true, composed: true }),
  );
  input.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
}

export function createPointerEvent(
  type: string,
  { clientX = 0, clientY = 0 } = {},
) {
  const event = new Event(type, {
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperties(event, {
    button: { value: 0 },
    clientX: { value: clientX },
    clientY: { value: clientY },
    pointerId: { value: 1 },
  });
  return event;
}

export async function advanceAutosaveDelay(delay = 750) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(delay);
    await Promise.resolve();
    await Promise.resolve();
  });
  await flushEffects();
}

export async function expectEventually(assertFn: () => void) {
  let lastError: unknown;
  for (let i = 0; i < 8; i += 1) {
    try {
      assertFn();
      return;
    } catch (error) {
      lastError = error;
      await flushEffects();
    }
  }
  throw lastError ?? new Error("Expectation not met");
}

export async function getIncludeInput() {
  await flushEffects();

  // Find input by its associated label instead of static ID
  const labels = Array.from(container.querySelectorAll("label"));
  const includeRegexLabel = labels.find((label) =>
    label.textContent?.includes("Include regex"),
  );

  let input: HTMLInputElement | null = null;

  if (includeRegexLabel?.htmlFor) {
    // Use getElementById which handles special characters in IDs correctly
    input = document.getElementById(
      includeRegexLabel.htmlFor,
    ) as HTMLInputElement;
  }

  // Fallback: find by placeholder text
  if (!input) {
    const allInputs = Array.from(
      container.querySelectorAll('input[type="text"]'),
    ) as HTMLInputElement[];
    // The include regex input comes before exclude regex input
    // and should be in the "Regex filter" section
    input =
      allInputs.find((inp) => {
        const placeholder = inp.placeholder;
        return (
          placeholder && (placeholder.includes("Regex") || placeholder === "")
        );
      }) || allInputs[0];
  }

  if (!input) {
    throw new Error("include-regex-repo input not rendered");
  }
  return input;
}
