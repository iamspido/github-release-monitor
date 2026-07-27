// @vitest-environment jsdom
import type React from "react";
import { act } from "react";
import ReactDOM from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
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

vi.mock("@/hooks/use-network", () => ({
  useNetworkStatus: () => networkState,
}));

const toastSpy = vi.fn();

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

const updateSettingsMock = vi.fn();
const refreshRepositoryMock = vi.fn();

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

const baseSettings: AppSettings = {
  timeFormat: "24h",
  locale: "en",
  refreshInterval: 5,
  cacheInterval: 5,
  releasesPerPage: 10,
  parallelRepoFetches: 3,
  releaseChannels: ["stable"],
};

const emptyRepoSettings: Pick<
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

describe("RepoSettingsDialog autosave behaviour", () => {
  let container: HTMLDivElement;
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

  function renderDialog(
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

  async function flushEffects() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  function setInputValue(input: HTMLInputElement, value: string) {
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
    input.dispatchEvent(
      new Event("change", { bubbles: true, cancelable: true }),
    );
  }

  function createPointerEvent(type: string, { clientX = 0, clientY = 0 } = {}) {
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

  async function advanceAutosaveDelay(delay = 750) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(delay);
      await Promise.resolve();
      await Promise.resolve();
    });
    await flushEffects();
  }

  async function expectEventually(assertFn: () => void) {
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

  async function getIncludeInput() {
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

  it("pauses autosave when offline without calling update action", async () => {
    networkState = { isOnline: false };
    renderDialog();
    await flushEffects();
    expect(document.body.textContent).toContain(
      "Offline – this dialog is read-only. Changes will not be saved until you're back online.",
    );
    expect(updateSettingsMock).not.toHaveBeenCalled();
  });

  it("associates the release selection label with its trigger", async () => {
    renderDialog();
    await flushEffects();

    const label = Array.from(container.querySelectorAll("label")).find(
      (candidate) => candidate.textContent === "Release selection",
    );
    expect(label?.htmlFor).toBeTruthy();
    expect(
      document.getElementById(label?.htmlFor ?? "")?.getAttribute("role"),
    ).toBe("combobox");
  });

  it("autosaves a valid repository version tag pattern", async () => {
    renderDialog({
      currentRepoSettings: {
        ...emptyRepoSettings,
        releaseSelectionStrategy: "highest_version",
        versionTagPattern: "^pkg/(?<version>\\d+\\.\\d+\\.\\d+)$",
      },
    });
    await flushEffects();

    const label = Array.from(container.querySelectorAll("label")).find(
      (candidate) => candidate.textContent === "Version tag pattern (optional)",
    );
    const input = document.getElementById(
      label?.htmlFor ?? "",
    ) as HTMLInputElement | null;
    expect(input?.disabled).toBe(false);

    const pattern =
      "^docker/(?<version>\\d+\\.\\d+\\.\\d+)-r(?<revision>\\d+)$";
    await act(async () => {
      if (input) setInputValue(input, pattern);
    });
    await advanceAutosaveDelay();

    expect(updateSettingsMock).toHaveBeenCalledWith(
      "owner/repo",
      expect.objectContaining({ versionTagPattern: pattern }),
    );
  });

  it("blocks autosave when the version tag pattern has no version group", async () => {
    renderDialog({
      currentRepoSettings: {
        ...emptyRepoSettings,
        releaseSelectionStrategy: "highest_version",
      },
    });
    await flushEffects();

    const label = Array.from(container.querySelectorAll("label")).find(
      (candidate) => candidate.textContent === "Version tag pattern (optional)",
    );
    const input = document.getElementById(
      label?.htmlFor ?? "",
    ) as HTMLInputElement | null;

    await act(async () => {
      if (input) setInputValue(input, "^(\\d+\\.\\d+\\.\\d+)$");
    });
    await advanceAutosaveDelay();

    expect(container.textContent).toContain("Missing named version group");
    expect(updateSettingsMock).not.toHaveBeenCalled();
  });

  it("does not replace inherited prerelease subchannels when opened", async () => {
    const inheritedSettings = {
      ...emptyRepoSettings,
      preReleaseSubChannels: undefined,
    };

    renderDialog({
      isOpen: false,
      currentRepoSettings: inheritedSettings,
    });
    renderDialog({ currentRepoSettings: inheritedSettings });
    await flushEffects();
    await advanceAutosaveDelay();

    expect(updateSettingsMock).not.toHaveBeenCalled();
  });

  it("does not autosave a stale closed draft while hydrating updated props", async () => {
    renderDialog({ isOpen: false });
    await flushEffects();

    renderDialog({
      currentRepoSettings: {
        ...emptyRepoSettings,
        includeRegex: "from-parent",
      },
    });
    await flushEffects();
    await advanceAutosaveDelay();

    expect((await getIncludeInput()).value).toBe("from-parent");
    expect(updateSettingsMock).not.toHaveBeenCalled();
  });

  it("refreshes after a filter save that finishes after the dialog closes", async () => {
    let resolveSave: ((value: { success: true }) => void) | undefined;
    updateSettingsMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSave = resolve;
      }),
    );

    renderDialog();
    const input = await getIncludeInput();
    await act(async () => {
      setInputValue(input, "feature");
    });
    await flushEffects();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(750);
      await Promise.resolve();
    });
    expect(updateSettingsMock).toHaveBeenCalledOnce();

    renderDialog({ isOpen: false });
    await flushEffects();
    expect(refreshRepositoryMock).not.toHaveBeenCalled();

    await act(async () => {
      resolveSave?.({ success: true });
      await Promise.resolve();
      await Promise.resolve();
    });

    await expectEventually(() => {
      expect(refreshRepositoryMock).toHaveBeenCalledWith("owner/repo");
    });
  });

  it("preserves an in-flight draft when the dialog reopens", async () => {
    let resolveSave: ((value: { success: true }) => void) | undefined;
    updateSettingsMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSave = resolve;
      }),
    );

    renderDialog();
    const input = await getIncludeInput();
    await act(async () => {
      setInputValue(input, "discarded-filter");
    });
    await flushEffects();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(750);
      await Promise.resolve();
    });
    expect(updateSettingsMock).toHaveBeenCalledOnce();

    renderDialog({ isOpen: false });
    await flushEffects();
    renderDialog();
    await flushEffects();
    expect((await getIncludeInput()).value).toBe("discarded-filter");

    await act(async () => {
      resolveSave?.({ success: true });
      await Promise.resolve();
      await Promise.resolve();
    });
    await advanceAutosaveDelay();
    expect(updateSettingsMock).toHaveBeenCalledOnce();
  });

  it("keeps a close-flushed snapshot immediate when reopening during an in-flight save", async () => {
    let resolveFirstSave: ((value: { success: true }) => void) | undefined;
    updateSettingsMock
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirstSave = resolve;
        }),
      )
      .mockResolvedValueOnce({ success: true });
    const setIsOpen = vi.fn();

    renderDialog({ setIsOpen });
    const input = await getIncludeInput();
    await act(async () => {
      setInputValue(input, "first-filter");
    });
    await flushEffects();
    await advanceAutosaveDelay();
    expect(updateSettingsMock).toHaveBeenCalledOnce();

    await act(async () => {
      setInputValue(input, "latest-filter");
    });
    await flushEffects();
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="close-repository-settings"]',
        )
        ?.click();
    });
    expect(setIsOpen).toHaveBeenCalledWith(false);

    renderDialog({ isOpen: false, setIsOpen });
    await flushEffects();
    renderDialog({ setIsOpen });
    await flushEffects();

    await act(async () => {
      resolveFirstSave?.({ success: true });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(updateSettingsMock).toHaveBeenCalledTimes(2);
    expect(updateSettingsMock).toHaveBeenLastCalledWith(
      "owner/repo",
      expect.objectContaining({ includeRegex: "latest-filter" }),
    );
  });

  it("drops a waiting snapshot when the draft returns to the saved snapshot", async () => {
    let resolveFirstSave: ((value: { success: true }) => void) | undefined;
    updateSettingsMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFirstSave = resolve;
      }),
    );

    renderDialog();
    const input = await getIncludeInput();
    await act(async () => {
      setInputValue(input, "saved-filter");
    });
    await flushEffects();
    await advanceAutosaveDelay();
    expect(updateSettingsMock).toHaveBeenCalledOnce();

    await act(async () => {
      setInputValue(input, "stale-filter");
    });
    await flushEffects();
    await act(async () => {
      resolveFirstSave?.({ success: true });
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      setInputValue(input, "saved-filter");
    });
    await flushEffects();
    await advanceAutosaveDelay(1000);

    expect(updateSettingsMock).toHaveBeenCalledOnce();
  });

  it("shows success and commits settings when autosave succeeds", async () => {
    updateSettingsMock.mockResolvedValueOnce({ success: true });

    renderDialog();
    const input = await getIncludeInput();
    await act(async () => {
      setInputValue(input, "feature");
    });
    await flushEffects();

    await advanceAutosaveDelay();

    await act(async () => {
      await expectEventually(() => {
        expect(updateSettingsMock).toHaveBeenCalledWith(
          "owner/repo",
          expect.objectContaining({ includeRegex: "feature" }),
        );
      });
    });
    await act(async () => {
      await expectEventually(() => {
        expect(document.body.textContent).toContain("Saved");
      });
    });
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it("shows the display section first and autosaves the display name", async () => {
    const onDisplayNameChange = vi.fn();
    renderDialog({ onDisplayNameChange });
    await flushEffects();

    const sectionHeadings = Array.from(container.querySelectorAll("h4"));
    expect(sectionHeadings[0]?.textContent).toBe("Display");

    const input = container.querySelector<HTMLInputElement>(
      'input[maxlength="100"]',
    );
    expect(input).not.toBeNull();
    expect(input?.placeholder).toBe("repo");

    await act(async () => {
      if (input) setInputValue(input, "Production Monitor");
    });
    await flushEffects();
    await advanceAutosaveDelay();

    await expectEventually(() => {
      expect(updateSettingsMock).toHaveBeenCalledWith(
        "owner/repo",
        expect.objectContaining({ displayName: "Production Monitor" }),
      );
    });
    expect(onDisplayNameChange).not.toHaveBeenCalled();

    renderDialog({ isOpen: false, onDisplayNameChange });
    await flushEffects();
    expect(onDisplayNameChange).toHaveBeenCalledWith("Production Monitor");
  });

  it("sends a serializable empty value when clearing the display name", async () => {
    renderDialog({
      currentRepoSettings: {
        ...emptyRepoSettings,
        displayName: "Production Monitor",
      },
    });
    await flushEffects();

    const input = container.querySelector<HTMLInputElement>(
      'input[maxlength="100"]',
    );
    expect(input).not.toBeNull();
    expect(input?.value).toBe("Production Monitor");

    await act(async () => {
      if (input) setInputValue(input, "");
    });
    await flushEffects();
    await advanceAutosaveDelay();

    await expectEventually(() => {
      expect(updateSettingsMock).toHaveBeenCalledWith(
        "owner/repo",
        expect.objectContaining({ displayName: "" }),
      );
    });
  });

  it("autosaves pinning and publishes it after the dialog closes", async () => {
    const onPinnedChange = vi.fn();
    renderDialog({ onPinnedChange });
    await flushEffects();

    const pinLabel = Array.from(container.querySelectorAll("label")).find(
      (label) => label.textContent === "Pin to top",
    );
    const checkbox = pinLabel?.htmlFor
      ? document.getElementById(pinLabel.htmlFor)
      : null;
    expect(checkbox?.getAttribute("role")).toBe("checkbox");

    await act(async () => {
      (checkbox as HTMLButtonElement | null)?.click();
    });
    await flushEffects();

    await expectEventually(() => {
      expect(updateSettingsMock).toHaveBeenCalledWith(
        "owner/repo",
        expect.objectContaining({ isPinned: true }),
      );
    });
    expect(onPinnedChange).not.toHaveBeenCalled();

    renderDialog({ isOpen: false, onPinnedChange });
    await flushEffects();
    expect(onPinnedChange).toHaveBeenCalledWith(true);
  });

  it("flushes a valid text change when the dialog closes", async () => {
    const setIsOpen = vi.fn();
    renderDialog({ setIsOpen });
    const input = await getIncludeInput();
    await act(async () => {
      setInputValue(input, "^v$");
    });
    await flushEffects();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="close-repository-settings"]',
        )
        ?.click();
      await Promise.resolve();
    });

    expect(setIsOpen).toHaveBeenCalledWith(false);
    expect(updateSettingsMock).toHaveBeenCalledWith(
      "owner/repo",
      expect.objectContaining({ includeRegex: "^v$" }),
    );
  });

  it("keeps the dialog open when unsaved settings are invalid", async () => {
    const setIsOpen = vi.fn();
    renderDialog({ setIsOpen });
    const input = await getIncludeInput();
    await act(async () => {
      setInputValue(input, "(");
    });
    await flushEffects();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="close-repository-settings"]',
        )
        ?.click();
      await vi.advanceTimersByTimeAsync(20);
    });

    expect(setIsOpen).not.toHaveBeenCalled();
    expect(updateSettingsMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain(
      "Fix invalid settings before closing",
    );
    expect(document.activeElement).toBe(input);
  });

  it("clears the close warning after restoring a valid saved value", async () => {
    const setIsOpen = vi.fn();
    renderDialog({ setIsOpen });
    const input = await getIncludeInput();
    await act(async () => {
      setInputValue(input, "(");
    });
    await flushEffects();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="close-repository-settings"]',
        )
        ?.click();
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(container.textContent).toContain(
      "Fix invalid settings before closing",
    );

    await act(async () => {
      setInputValue(input, "");
    });
    await flushEffects();

    expect(container.textContent).not.toContain(
      "Fix invalid settings before closing",
    );
  });

  it("blocks closing and focuses an invalid display name", async () => {
    const setIsOpen = vi.fn();
    renderDialog({ setIsOpen });
    const displayNameInput = container.querySelector<HTMLInputElement>(
      'input[maxlength="100"]',
    );
    expect(displayNameInput).not.toBeNull();

    await act(async () => {
      if (displayNameInput) setInputValue(displayNameInput, "bad\u0007name");
    });
    await flushEffects();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="close-repository-settings"]',
        )
        ?.click();
      await vi.advanceTimersByTimeAsync(20);
    });

    expect(setIsOpen).not.toHaveBeenCalled();
    expect(updateSettingsMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Enter a valid display name");
    expect(document.activeElement).toBe(displayNameInput);
  });

  it("commits a pending tag when the dialog closes", async () => {
    const setIsOpen = vi.fn();
    renderDialog({ setIsOpen });
    const tagInput = container.querySelector<HTMLInputElement>(
      'input[role="combobox"]',
    );
    expect(tagInput).not.toBeNull();

    await act(async () => {
      if (tagInput) setInputValue(tagInput, "critical");
    });
    await flushEffects();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="close-repository-settings"]',
        )
        ?.click();
      await Promise.resolve();
    });

    expect(setIsOpen).toHaveBeenCalledWith(false);
    expect(updateSettingsMock).toHaveBeenCalledWith(
      "owner/repo",
      expect.objectContaining({ tags: ["critical"] }),
    );
  });

  it("blocks closing and focuses an invalid pending tag", async () => {
    const setIsOpen = vi.fn();
    renderDialog({ setIsOpen });
    const tagInput = container.querySelector<HTMLInputElement>(
      'input[role="combobox"]',
    );
    expect(tagInput).not.toBeNull();

    await act(async () => {
      if (tagInput) setInputValue(tagInput, "x".repeat(41));
    });
    await flushEffects();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="close-repository-settings"]',
        )
        ?.click();
      await vi.advanceTimersByTimeAsync(20);
    });

    expect(setIsOpen).not.toHaveBeenCalled();
    expect(updateSettingsMock).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(tagInput);
  });

  it("blocks closing when a rejected comma-separated tag leaves an empty input", async () => {
    const setIsOpen = vi.fn();
    renderDialog({ setIsOpen });
    const tagInput = container.querySelector<HTMLInputElement>(
      'input[role="combobox"]',
    );
    expect(tagInput).not.toBeNull();

    await act(async () => {
      if (tagInput) setInputValue(tagInput, `${"x".repeat(41)},`);
    });
    await flushEffects();
    expect(tagInput?.value).toBe("");

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="close-repository-settings"]',
        )
        ?.click();
      await vi.advanceTimersByTimeAsync(20);
    });

    expect(setIsOpen).not.toHaveBeenCalled();
    expect(updateSettingsMock).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(tagInput);
  });

  it("blocks closing when an active interval field is empty", async () => {
    const setIsOpen = vi.fn();
    renderDialog({
      setIsOpen,
      currentRepoSettings: {
        ...emptyRepoSettings,
        refreshInterval: 60,
      },
    });
    const minuteLabel = Array.from(container.querySelectorAll("label")).find(
      (label) =>
        label.textContent === "SettingsForm.refresh_interval_minutes_label",
    );
    const minuteInput = minuteLabel?.htmlFor
      ? (document.getElementById(
          minuteLabel.htmlFor,
        ) as HTMLInputElement | null)
      : null;
    expect(minuteInput).not.toBeNull();

    await act(async () => {
      if (minuteInput) setInputValue(minuteInput, "");
    });
    await flushEffects();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="close-repository-settings"]',
        )
        ?.click();
      await vi.advanceTimersByTimeAsync(20);
    });

    expect(setIsOpen).not.toHaveBeenCalled();
    expect(updateSettingsMock).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(minuteInput);
  });

  it("requeues a failed snapshot after a temporary validation error", async () => {
    const setIsOpen = vi.fn();
    updateSettingsMock
      .mockResolvedValueOnce({ success: false, error: "save failed" })
      .mockResolvedValueOnce({ success: true });
    renderDialog({ setIsOpen });
    const input = await getIncludeInput();

    await act(async () => {
      setInputValue(input, "feature");
    });
    await flushEffects();
    await advanceAutosaveDelay();
    expect(updateSettingsMock).toHaveBeenCalledOnce();

    await act(async () => {
      setInputValue(input, "(");
    });
    await flushEffects();
    await act(async () => {
      setInputValue(input, "feature");
    });
    await flushEffects();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="close-repository-settings"]',
        )
        ?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(setIsOpen).toHaveBeenCalledWith(false);
    expect(updateSettingsMock).toHaveBeenCalledTimes(2);
    expect(updateSettingsMock).toHaveBeenLastCalledWith(
      "owner/repo",
      expect.objectContaining({ includeRegex: "feature" }),
    );
  });

  it("retries a failed in-flight snapshot after an invalid draft is corrected", async () => {
    let resolveSave:
      | ((value: { success: false; error: string }) => void)
      | undefined;
    updateSettingsMock
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
      )
      .mockResolvedValueOnce({ success: true });
    renderDialog();
    const input = await getIncludeInput();

    await act(async () => {
      setInputValue(input, "feature");
    });
    await flushEffects();
    await advanceAutosaveDelay();
    expect(updateSettingsMock).toHaveBeenCalledOnce();

    await act(async () => {
      setInputValue(input, "(");
    });
    await flushEffects();
    await act(async () => {
      resolveSave?.({ success: false, error: "save failed" });
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      setInputValue(input, "feature");
    });
    await flushEffects();
    await advanceAutosaveDelay(749);
    expect(updateSettingsMock).toHaveBeenCalledOnce();
    await advanceAutosaveDelay(1);
    expect(updateSettingsMock).toHaveBeenCalledTimes(2);
  });

  it("does not make the next text edit immediate after a no-op reset", async () => {
    renderDialog();
    await flushEffects();
    const automationHeading = Array.from(container.querySelectorAll("h4")).find(
      (heading) => heading.textContent === "Automation",
    );
    const automationSection = automationHeading?.parentElement?.parentElement;
    const resetButton =
      automationSection?.querySelector<HTMLButtonElement>("button");
    expect(resetButton).not.toBeNull();

    await act(async () => {
      resetButton?.click();
    });
    await flushEffects();
    expect(updateSettingsMock).not.toHaveBeenCalled();

    const displayNameInput = container.querySelector<HTMLInputElement>(
      'input[maxlength="100"]',
    );
    await act(async () => {
      if (displayNameInput) setInputValue(displayNameInput, "Delayed name");
    });
    await flushEffects();
    expect(updateSettingsMock).not.toHaveBeenCalled();
    await advanceAutosaveDelay();
    expect(updateSettingsMock).toHaveBeenCalledOnce();
  });

  it("resets the release selection override with all repository settings", async () => {
    renderDialog({
      currentRepoSettings: {
        ...emptyRepoSettings,
        releaseSelectionStrategy: "highest_version",
        versionTagPattern: "^pkg/(?<version>\\d+\\.\\d+\\.\\d+)$",
      },
    });
    await flushEffects();

    const resetAllButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("Reset all"));
    expect(resetAllButton).toBeDefined();

    await act(async () => {
      resetAllButton?.click();
    });
    await flushEffects();

    const confirmButton = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("Confirm reset all"));
    expect(confirmButton).toBeDefined();

    await act(async () => {
      confirmButton?.click();
    });
    await flushEffects();
    await advanceAutosaveDelay();

    expect(updateSettingsMock).toHaveBeenCalledWith(
      "owner/repo",
      expect.objectContaining({
        releaseSelectionStrategy: undefined,
        versionTagPattern: undefined,
      }),
    );
  });

  it("reorders repository tags with controls and autosaves their order", async () => {
    renderDialog({ currentRepositoryTags: ["infra", "media", "retro"] });
    await flushEffects();

    const moveRightButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        'button[aria-label="Move tag right"]',
      ),
    );
    expect(moveRightButtons).toHaveLength(3);

    await act(async () => {
      moveRightButtons[0].click();
    });
    await advanceAutosaveDelay();

    await expectEventually(() => {
      expect(updateSettingsMock).toHaveBeenCalledWith(
        "owner/repo",
        expect.objectContaining({ tags: ["media", "infra", "retro"] }),
      );
    });
  });

  it("maps repository tag controls to the visible RTL direction", async () => {
    mockedLocale = "ar";
    renderDialog({ currentRepositoryTags: ["infra", "media", "retro"] });
    await flushEffects();

    const moveRightButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        'button[aria-label="Move tag right"]',
      ),
    );
    expect(moveRightButtons).toHaveLength(3);
    expect(moveRightButtons[0].disabled).toBe(true);

    await act(async () => {
      moveRightButtons[1].click();
    });
    await advanceAutosaveDelay();

    await expectEventually(() => {
      expect(updateSettingsMock).toHaveBeenCalledWith(
        "owner/repo",
        expect.objectContaining({ tags: ["media", "infra", "retro"] }),
      );
    });
  });

  it("publishes saved tag changes only after the dialog closes", async () => {
    const onRepositoryTagsChange = vi.fn();
    const props = {
      currentRepositoryTags: ["infra", "media"],
      onRepositoryTagsChange,
    };
    renderDialog(props);
    await flushEffects();

    const moveRightButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Move tag right"]',
    );
    expect(moveRightButton).not.toBeNull();

    await act(async () => {
      moveRightButton?.click();
    });
    await advanceAutosaveDelay();
    await expectEventually(() => {
      expect(updateSettingsMock).toHaveBeenCalledWith(
        "owner/repo",
        expect.objectContaining({ tags: ["media", "infra"] }),
      );
    });
    expect(onRepositoryTagsChange).not.toHaveBeenCalled();

    renderDialog({ ...props, isOpen: false });
    await flushEffects();

    expect(onRepositoryTagsChange).toHaveBeenCalledOnce();
    expect(onRepositoryTagsChange).toHaveBeenCalledWith(["media", "infra"]);
  });

  it("reorders repository tags with pointer dragging", async () => {
    renderDialog({ currentRepositoryTags: ["infra", "media", "retro"] });
    await flushEffects();

    const movableTags = Array.from(
      container.querySelectorAll<HTMLElement>(
        "li[data-repository-tag-index] > div",
      ),
    );
    expect(movableTags).toHaveLength(3);

    await act(async () => {
      movableTags[0].dispatchEvent(createPointerEvent("pointerdown"));
      movableTags[0].dispatchEvent(
        createPointerEvent("pointermove", { clientX: 10 }),
      );
    });
    expect(
      container.querySelector('[data-tag-drop-placeholder="true"]'),
    ).not.toBeNull();
    await act(async () => {
      movableTags[0].dispatchEvent(
        createPointerEvent("pointerup", { clientX: 10 }),
      );
    });
    await advanceAutosaveDelay();

    await expectEventually(() => {
      expect(updateSettingsMock).toHaveBeenCalledWith(
        "owner/repo",
        expect.objectContaining({ tags: ["media", "retro", "infra"] }),
      );
    });
  });

  it("cancels pointer dragging without reordering or autosaving tags", async () => {
    renderDialog({ currentRepositoryTags: ["infra", "media", "retro"] });
    await flushEffects();

    const movableTags = Array.from(
      container.querySelectorAll<HTMLElement>(
        "li[data-repository-tag-index] > div",
      ),
    );

    await act(async () => {
      movableTags[0].dispatchEvent(createPointerEvent("pointerdown"));
      movableTags[0].dispatchEvent(
        createPointerEvent("pointermove", { clientX: 10 }),
      );
      movableTags[0].dispatchEvent(
        createPointerEvent("pointercancel", { clientX: 10 }),
      );
    });

    expect(
      Array.from(
        container.querySelectorAll<HTMLElement>(
          "li[data-repository-tag-index]",
        ),
      ).map((item) => item.textContent),
    ).toEqual(["infra", "media", "retro"]);
    expect(document.body.querySelector('[data-tag-drag-preview="true"]')).toBe(
      null,
    );
    await advanceAutosaveDelay();
    expect(updateSettingsMock).not.toHaveBeenCalled();
  });

  it("cleans up pointer dragging when the dialog closes", async () => {
    const props = { currentRepositoryTags: ["infra", "media", "retro"] };
    renderDialog(props);
    await flushEffects();

    const movableTag = container.querySelector<HTMLElement>(
      "li[data-repository-tag-index] > div",
    );
    expect(movableTag).not.toBeNull();

    await act(async () => {
      movableTag?.dispatchEvent(createPointerEvent("pointerdown"));
      movableTag?.dispatchEvent(
        createPointerEvent("pointermove", { clientX: 10 }),
      );
    });
    expect(
      document.body.querySelector('[data-tag-drag-preview="true"]'),
    ).not.toBeNull();

    renderDialog({ ...props, isOpen: false });
    await flushEffects();

    expect(
      document.body.querySelector('[data-tag-drag-preview="true"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-tag-drop-placeholder="true"]'),
    ).toBeNull();
  });

  it("does not create a partial matching tag on blur", async () => {
    renderDialog({ availableRepositoryTags: ["media"] });
    await flushEffects();

    const tagInput = container.querySelector<HTMLInputElement>(
      'input[role="combobox"]',
    );
    expect(tagInput).not.toBeNull();

    await act(async () => {
      tagInput?.focus();
      if (tagInput) setInputValue(tagInput, "med");
      tagInput?.blur();
    });
    await advanceAutosaveDelay();

    expect(tagInput?.value).toBe("med");
    expect(updateSettingsMock).not.toHaveBeenCalled();
  });

  it("does not offer an already selected tag as a new tag", async () => {
    renderDialog({
      currentRepositoryTags: ["media"],
      availableRepositoryTags: ["media"],
    });
    await flushEffects();

    const tagInput = container.querySelector<HTMLInputElement>(
      'input[role="combobox"]',
    );
    await act(async () => {
      tagInput?.focus();
      if (tagInput) setInputValue(tagInput, "MEDIA");
    });

    expect(document.body.textContent).not.toContain("Add new tag");
  });

  it("searches and adds an existing tag from the integrated input", async () => {
    renderDialog({
      currentRepositoryTags: ["infra"],
      availableRepositoryTags: ["infra", "media", "retro"],
    });
    await flushEffects();

    const tagInput = container.querySelector<HTMLInputElement>(
      'input[role="combobox"]',
    );
    expect(tagInput).not.toBeNull();

    await act(async () => {
      tagInput?.focus();
      if (tagInput) setInputValue(tagInput, "med");
    });
    expect(document.body.textContent).toContain("media");
    expect(
      Array.from(document.body.querySelectorAll('[role="option"]')).some(
        (item) => item.textContent?.includes("retro"),
      ),
    ).toBe(false);

    await act(async () => {
      tagInput?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await flushEffects();
    expect(tagInput?.value).toBe("");
    await advanceAutosaveDelay();

    await expectEventually(() => {
      expect(updateSettingsMock).toHaveBeenCalledWith(
        "owner/repo",
        expect.objectContaining({ tags: ["infra", "media"] }),
      );
    });
  });

  it("creates the typed tag when the integrated search has no match", async () => {
    renderDialog({ availableRepositoryTags: ["infra", "media"] });
    await flushEffects();

    const tagInput = container.querySelector<HTMLInputElement>(
      'input[role="combobox"]',
    );
    expect(tagInput).not.toBeNull();

    await act(async () => {
      tagInput?.focus();
      if (tagInput) setInputValue(tagInput, "retro");
    });
    expect(document.body.textContent).toContain("Add new tag");

    await act(async () => {
      tagInput?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await advanceAutosaveDelay();

    await expectEventually(() => {
      expect(updateSettingsMock).toHaveBeenCalledWith(
        "owner/repo",
        expect.objectContaining({ tags: ["retro"] }),
      );
    });
  });

  it("does not remove tags when Backspace or Delete is pressed in an empty input", async () => {
    renderDialog({ currentRepositoryTags: ["infra", "media"] });
    await flushEffects();

    const tagInput = container.querySelector<HTMLInputElement>(
      'input[placeholder="RepoSettingsDialog.tags_placeholder"]',
    );
    expect(tagInput).not.toBeNull();

    await act(async () => {
      tagInput?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }),
      );
      tagInput?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Delete", bubbles: true }),
      );
    });
    await advanceAutosaveDelay();

    expect(updateSettingsMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain("infra");
    expect(container.textContent).toContain("media");
  });

  it("blocks autosave when include regex becomes invalid", async () => {
    renderDialog();
    const input = await getIncludeInput();
    await act(async () => {
      setInputValue(input, "(");
    });
    await flushEffects();

    await advanceAutosaveDelay();

    await act(async () => {
      await expectEventually(() => {
        expect(document.body.textContent).toContain(
          "Invalid regular expression.",
        );
      });
    });
    expect(updateSettingsMock).not.toHaveBeenCalled();
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it("shows error toast when autosave returns failure", async () => {
    updateSettingsMock.mockResolvedValueOnce({ success: false, error: "nope" });

    renderDialog();
    const input = await getIncludeInput();
    await act(async () => {
      setInputValue(input, "feature");
    });
    await flushEffects();

    await advanceAutosaveDelay();

    await act(async () => {
      await expectEventually(() => {
        expect(toastSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "Save error",
            description: "nope",
            variant: "destructive",
          }),
        );
      });
    });
    expect(updateSettingsMock).toHaveBeenCalled();
  });

  it("shows error toast when autosave throws", async () => {
    updateSettingsMock.mockRejectedValueOnce(new Error("broken"));

    renderDialog();
    const input = await getIncludeInput();
    await act(async () => {
      setInputValue(input, "feature");
    });
    await flushEffects();

    await advanceAutosaveDelay();

    await act(async () => {
      await expectEventually(() => {
        expect(toastSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "Save error",
            description: "Error: broken",
            variant: "destructive",
          }),
        );
      });
    });
    expect(updateSettingsMock).toHaveBeenCalled();
  });
});
