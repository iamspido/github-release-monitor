// @vitest-environment jsdom
import type React from "react";
import { act } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, beforeAll, beforeEach, vi } from "vitest";
import type { AppSettings, EnrichedRelease } from "@/types";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type RichValues = Record<
  string,
  ((chunks: string) => React.ReactNode) | string
>;
type TranslationFn = ((
  key: string,
  values?: Record<string, unknown>,
) => string) & {
  rich: (key: string, values?: RichValues) => React.ReactNode;
};

const translationMap: Record<string, Record<string, string>> = {
  ReleaseCard: {
    error_title: "Repository error",
    custom_settings_badge: "[Custom settings]",
    custom_settings_tooltip: "Overrides applied",
    pinned_badge: "Pinned",
    pinned_tooltip: "Pinned to top",
    repository_tags_more_aria: "{count} more repository tags: {tags}",
    security_release_badge: "Security",
    new_release_badge: "New",
    expand_details: "Expand release details for {repo}",
    collapse_details: "Collapse release details for {repo}",
    settings_button_aria: "Open repository settings",
    toast_error_title: "Something went wrong",
    toast_success_title: "Success",
    toast_mark_as_new_success: "Marked as new",
    toast_mark_as_new_error_generic: "Failed to mark as new",
    toast_acknowledge_error_generic: "Failed to acknowledge",
    toast_error_description: "Error occurred",
    acknowledge_button: "Acknowledge release",
    acknowledge_button_for_repo: "Mark release for {repo} as seen",
    mark_as_new_button: "Mark as new",
    mark_as_new_button_for_repo: "Mark release for {repo} as new",
    remove_button: "Remove repository",
    remove_button_for_repo: "Remove {repo}",
    confirm_dialog_title: "Remove repository?",
    confirm_dialog_description_long: "Remove {repoId}?",
    security_acknowledge_confirm_title: "Confirm security acknowledge",
    security_acknowledge_confirm_description: "Confirm {repoId}",
    security_acknowledge_confirm_button: "Confirm security seen",
    confirm_button: "Confirm removal",
    cancel_button: "Cancel",
    view_on_github: "Open release",
    view_tag: "Open tag",
    view_release_for_repo: "Open release for {repo}",
    view_tag_for_repo: "Open tag for {repo}",
    settings_button_aria_for_repo: "Open settings for {repo}",
    released_ago: "Released {time}",
    checked_ago: "Checked {time}",
    no_release_notes: "No release notes available",
    offline_tooltip: "Go online to continue",
    error_title_with_repo: "Error for repository",
  },
  Actions: {
    error_repo_not_found: "Repository not found",
    error_generic_fetch: "Generic fetch error",
    error_rate_limit: "Rate limit exceeded",
  },
};

function interpolate(template: string, values?: Record<string, unknown>) {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (_, token) => {
    const replacement = values[token];
    return typeof replacement === "string" || typeof replacement === "number"
      ? String(replacement)
      : "";
  });
}

vi.mock("next-intl", () => ({
  useFormatter: () => ({
    relativeTime: (value: Date) => {
      if (Number.isNaN(value.getTime())) {
        throw new RangeError("Invalid time value");
      }
      return "relative time";
    },
  }),
  useTranslations: (namespace: string) => {
    const dict = translationMap[namespace] ?? {};
    const translate = ((key: string, values?: Record<string, unknown>) => {
      const message = dict[key];
      if (!message) return `${namespace}.${key}`;
      return interpolate(message, values);
    }) as TranslationFn;
    translate.rich = (key: string, values?: RichValues) => {
      const message = dict[key];
      if (!message) return `${namespace}.${key}`;
      const resolved = interpolate(message, values);
      const bold = values?.bold;
      if (typeof bold === "function") {
        return bold(resolved);
      }
      return resolved;
    };
    return translate;
  },
  useLocale: () => "en",
}));

let networkState = { isOnline: true };

export function setNetworkOnline(isOnline: boolean) {
  networkState = { isOnline };
}

vi.mock("@/hooks/use-network", () => ({
  useNetworkStatus: () => networkState,
}));

export const toastSpy = vi.fn();
export const dismissToastSpy = vi.fn();

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: toastSpy,
    dismiss: dismissToastSpy,
  }),
}));

vi.mock("react-markdown", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="markdown">{children}</div>
  ),
}));

vi.mock("remark-gfm", () => ({
  __esModule: true,
  default: () => {},
}));
vi.mock("remark-gemoji", () => ({
  __esModule: true,
  default: () => {},
}));

vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="tooltip-content">{children}</div>
  ),
}));

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="alert-dialog">{children}</div>
  ),
  AlertDialogTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  AlertDialogContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogDescription: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogCancel: ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
  AlertDialogAction: ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/repo-settings-dialog", () => ({
  RepoSettingsDialog: ({
    isOpen,
    setIsOpen,
  }: {
    isOpen: boolean;
    setIsOpen: (open: boolean) => void;
  }) => (
    <div data-testid="repo-settings-dialog" data-open={isOpen}>
      {isOpen ? (
        <button type="button" onClick={() => setIsOpen(false)}>
          Close settings
        </button>
      ) : null}
    </div>
  ),
}));

vi.mock("@/app/actions", () => ({
  removeRepositoryAction: vi.fn().mockResolvedValue({}),
  acknowledgeNewReleaseAction: vi.fn().mockResolvedValue({ success: true }),
  markAsNewAction: vi.fn().mockResolvedValue({ success: true }),
  revalidateReleasesAction: vi.fn(),
}));

export async function mockedActions() {
  const actions = await import("@/app/actions");
  return {
    removeRepositoryAction: vi.mocked(actions.removeRepositoryAction),
    acknowledgeNewReleaseAction: vi.mocked(actions.acknowledgeNewReleaseAction),
    markAsNewAction: vi.mocked(actions.markAsNewAction),
  };
}

export const baseSettings: AppSettings = {
  timeFormat: "24h",
  locale: "en",
  refreshInterval: 5,
  cacheInterval: 5,
  releasesPerPage: 5,
  parallelRepoFetches: 3,
  releaseChannels: ["stable"],
  showAcknowledge: true,
  showMarkAsNew: true,
};

export const makeRelease = (): EnrichedRelease => ({
  repoId: "owner/repo",
  repoUrl: "https://github.com/owner/repo",
  release: {
    id: 1,
    html_url: "https://github.com/owner/repo/releases/tag/v1.0.0",
    tag_name: "v1.0.0",
    name: "v1.0.0",
    body: "## Notes",
    created_at: "2024-01-01T00:00:00.000Z",
    published_at: "2024-01-01T00:00:00.000Z",
    prerelease: false,
    draft: false,
    fetched_at: "2024-01-02T00:00:00.000Z",
  },
  repoSettings: {},
});

export function makeSecurityRelease(isNew: boolean): EnrichedRelease {
  const enrichedRelease = makeRelease();
  if (!enrichedRelease.release) {
    throw new Error("Base release missing release payload");
  }
  return {
    ...enrichedRelease,
    isNew,
    release: {
      ...enrichedRelease.release,
      name: "Security update",
      body: "Fixes CVE-2024-12345.",
    },
  };
}

export let container: HTMLDivElement | null = null;
export let root: ReactDOM.Root | null = null;
export let ReleaseCardComponent: typeof import("@/components/release-card").ReleaseCard;

beforeAll(async () => {
  ({ ReleaseCard: ReleaseCardComponent } = await import(
    "@/components/release-card"
  ));
}, 30000);

afterEach(() => {
  vi.useRealTimers();
  if (root && container) {
    act(() => {
      root?.unmount();
    });
    container.remove();
  }
  container = null;
  root = null;
});

beforeEach(async () => {
  vi.clearAllMocks();
  toastSpy.mockClear();
  dismissToastSpy.mockClear();
  networkState = { isOnline: true };
  const actions = await mockedActions();
  actions.removeRepositoryAction.mockClear();
  actions.acknowledgeNewReleaseAction.mockClear();
  actions.markAsNewAction.mockClear();

  container = document.createElement("div");
  document.body.appendChild(container);
  root = ReactDOM.createRoot(container);
});

export function render(component: React.ReactElement) {
  if (!root) throw new Error("Root not initialized");
  act(() => {
    root?.render(component);
  });
}

export async function unmountReleaseCard() {
  if (!root || !container) return;
  await act(async () => {
    root?.unmount();
  });
  root = null;
  container.remove();
  container = null;
}

export function getElementByText(tag: string, text: string) {
  if (!container) throw new Error("Container not initialized");
  const elements = Array.from(container.querySelectorAll(tag));
  return elements.find((el) => el.textContent?.includes(text));
}

export function getButtonBySpanText(text: string) {
  if (!container) throw new Error("Container not initialized");
  const spans = Array.from(container.querySelectorAll("span"));
  const match = spans.find((span) => span.textContent?.includes(text));
  return match ? (match.closest("button") as HTMLButtonElement | null) : null;
}
