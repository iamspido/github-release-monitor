// @vitest-environment jsdom
import React from 'react';
import ReactDOM from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EnrichedRelease, AppSettings } from '@/types';

const translationMap: Record<string, Record<string, string>> = {
  ReleaseCard: {
    error_title: 'Repository error',
    custom_settings_badge: '[Custom settings]',
    custom_settings_tooltip: 'Overrides applied',
    settings_button_aria: 'Open repository settings',
    toast_error_title: 'Something went wrong',
    toast_success_title: 'Success',
    toast_mark_as_new_success: 'Marked as new',
    toast_mark_as_new_error_generic: 'Failed to mark as new',
    toast_acknowledge_error_generic: 'Failed to acknowledge',
    toast_error_description: 'Error occurred',
    acknowledge_button: 'Acknowledge release',
    mark_as_new_button: 'Mark as new',
    remove_button: 'Remove repository',
    confirm_dialog_title: 'Remove repository?',
    confirm_dialog_description_long: 'Remove {repoId}?',
    confirm_button: 'Confirm removal',
    cancel_button: 'Cancel',
    view_on_github: 'Open release',
    view_tag: 'Open tag',
    released_ago: 'Released {time}',
    checked_ago: 'Checked {time}',
    no_release_notes: 'No release notes available',
    offline_tooltip: 'Go online to continue',
    error_title_with_repo: 'Error for repository',
  },
  Actions: {
    error_repo_not_found: 'Repository not found',
    error_generic_fetch: 'Generic fetch error',
    error_rate_limit: 'Rate limit exceeded',
  },
};

function interpolate(template: string, values?: Record<string, any>) {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (_, token) => {
    const replacement = values[token];
    return typeof replacement === 'string' ? replacement : '';
  });
}

vi.mock('next-intl', () => ({
  useTranslations: (namespace: string) => {
    const dict = translationMap[namespace] ?? {};
    const translate = ((key: string, values?: Record<string, any>) => {
      const message = dict[key];
      if (typeof message === 'function') {
        return message(values);
      }
      if (!message) return `${namespace}.${key}`;
      return interpolate(message, values);
    }) as any;
    translate.rich = (key: string, values: Record<string, any>) => {
      const message = dict[key];
      if (!message) return `${namespace}.${key}`;
      const resolved = interpolate(message, values);
      if (typeof values?.bold === 'function') {
        return values.bold(resolved);
      }
      return resolved;
    };
    return translate;
  },
  useLocale: () => 'en',
}));

let networkState = { isOnline: true };

vi.mock('@/hooks/use-network', () => ({
  useNetworkStatus: () => networkState,
}));

const toastSpy = vi.fn();
const dismissToastSpy = vi.fn();

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({
    toast: toastSpy,
    dismiss: dismissToastSpy,
  }),
}));

vi.mock('react-markdown', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="markdown">{children}</div>
  ),
}));

vi.mock('remark-gfm', () => ({
  __esModule: true,
  default: () => {},
}));
vi.mock('remark-gemoji', () => ({
  __esModule: true,
  default: () => {},
}));

vi.mock('@/components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <div data-testid="tooltip-content">{children}</div>,
}));

vi.mock('@/components/ui/alert-dialog', () => ({
  AlertDialog: ({ children }: { children: React.ReactNode }) => <div data-testid="alert-dialog">{children}</div>,
  AlertDialogTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  AlertDialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogCancel: ({ children }: { children: React.ReactNode }) => <button type="button">{children}</button>,
  AlertDialogAction: ({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

vi.mock('@/components/repo-settings-dialog', () => ({
  RepoSettingsDialog: ({ isOpen }: { isOpen: boolean }) => (
    <div data-testid="repo-settings-dialog" data-open={isOpen} />
  ),
}));

vi.mock('@/app/actions', () => ({
  removeRepositoryAction: vi.fn().mockResolvedValue({}),
  acknowledgeNewReleaseAction: vi.fn().mockResolvedValue({ success: true }),
  markAsNewAction: vi.fn().mockResolvedValue({ success: true }),
  revalidateReleasesAction: vi.fn(),
}));

const baseSettings: AppSettings = {
  timeFormat: '24h',
  locale: 'en',
  refreshInterval: 5,
  cacheInterval: 5,
  releasesPerPage: 5,
  parallelRepoFetches: 3,
  releaseChannels: ['stable'],
  showAcknowledge: true,
  showMarkAsNew: true,
};

const makeRelease = (): EnrichedRelease => ({
  repoId: 'owner/repo',
  repoUrl: 'https://github.com/owner/repo',
  release: {
    id: 1,
    html_url: 'https://github.com/owner/repo/releases/tag/v1.0.0',
    tag_name: 'v1.0.0',
    name: 'v1.0.0',
    body: '## Notes',
    created_at: '2024-01-01T00:00:00.000Z',
    published_at: '2024-01-01T00:00:00.000Z',
    prerelease: false,
    draft: false,
    fetched_at: '2024-01-02T00:00:00.000Z',
  },
  repoSettings: {},
});

let container: HTMLDivElement | null = null;
let root: ReactDOM.Root | null = null;
let ReleaseCardComponent: typeof import('@/components/release-card').ReleaseCard;

beforeAll(async () => {
  ({ ReleaseCard: ReleaseCardComponent } = await import('@/components/release-card'));
}, 30000);

afterEach(() => {
  vi.useRealTimers();
  if (root && container) {
    flushSync(() => {
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
  const actions = await import('@/app/actions');
  actions.removeRepositoryAction.mockClear();
  actions.acknowledgeNewReleaseAction.mockClear();
  actions.markAsNewAction.mockClear();

  container = document.createElement('div');
  document.body.appendChild(container);
  root = ReactDOM.createRoot(container);
});

function render(component: React.ReactElement) {
  if (!root) throw new Error('Root not initialized');
  flushSync(() => {
    root?.render(component);
  });
}

function getElementByText(tag: string, text: string) {
  if (!container) throw new Error('Container not initialized');
  const elements = Array.from(container.querySelectorAll(tag));
  return elements.find(el => el.textContent?.includes(text));
}

function getButtonBySpanText(text: string) {
  if (!container) throw new Error('Container not initialized');
  const spans = Array.from(container.querySelectorAll('span'));
  const match = spans.find(span => span.textContent?.includes(text));
  return match ? (match.closest('button') as HTMLButtonElement | null) : null;
}

describe('ReleaseCard component', () => {
  it('shows remove button even when release data is missing', async () => {
    const enrichedRelease: EnrichedRelease = {
      repoId: 'owner/repo',
      repoUrl: 'https://github.com/owner/repo',
      repoSettings: {},
    };

    render(<ReleaseCardComponent enrichedRelease={enrichedRelease} settings={baseSettings} />);

    expect(getElementByText('a', 'owner/repo')).toBeTruthy();
    const removeButton = Array.from(container?.querySelectorAll('button') ?? []).find(btn =>
      btn.textContent?.includes('Remove repository'),
    );
    expect(removeButton).toBeTruthy();
  });

  it('renders error state with translated message and custom settings badge', async () => {
    const enrichedRelease: EnrichedRelease = {
      repoId: 'owner/repo',
      repoUrl: 'https://github.com/owner/repo',
      error: { type: 'repo_not_found' },
      repoSettings: {
        releaseChannels: ['stable'],
      },
    };

    render(<ReleaseCardComponent enrichedRelease={enrichedRelease} settings={baseSettings} />);

    expect(getElementByText('a', 'owner/repo')).toBeTruthy();
    expect(getElementByText('p', 'Repository not found')).toBeTruthy();
    expect(container?.textContent?.includes('Custom settings')).toBe(true);
    const settingsButton = container?.querySelector('button[aria-label="Open repository settings"]');
    expect(settingsButton).toBeTruthy();
  });

  it('disables key actions when offline', async () => {
    networkState = { isOnline: false };

    const enrichedRelease = {
      ...makeRelease(),
      isNew: false,
    };

    render(<ReleaseCardComponent enrichedRelease={enrichedRelease} settings={baseSettings} />);

    const markAsNewButton = getButtonBySpanText('Mark as new');
    expect(markAsNewButton?.disabled).toBe(true);
    expect(markAsNewButton?.getAttribute('aria-disabled')).toBe('true');

    if (!container) throw new Error('Container not initialized');
    const removeButtons = Array.from(container.querySelectorAll('button')).filter(btn =>
      btn.textContent?.includes('Remove repository'),
    );
    removeButtons.forEach(button => {
      expect(button.disabled).toBe(true);
      expect(button.getAttribute('aria-disabled')).toBe('true');
    });
  });

  it('acknowledges a new release via the server action', async () => {
    networkState = { isOnline: true };
    const actions = await import('@/app/actions');
    actions.acknowledgeNewReleaseAction.mockResolvedValue({ success: true });

    const enrichedRelease = {
      ...makeRelease(),
      isNew: true,
    };

    render(<ReleaseCardComponent enrichedRelease={enrichedRelease} settings={baseSettings} />);

    const acknowledgeButton = getButtonBySpanText('Acknowledge release');
    expect(acknowledgeButton).toBeTruthy();
    acknowledgeButton?.click();

    await Promise.resolve();
    await Promise.resolve();
    expect(actions.acknowledgeNewReleaseAction).toHaveBeenCalledWith('owner/repo');
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it('shows toast error when mark-as-new action fails', async () => {
    networkState = { isOnline: true };
    const actions = await import('@/app/actions');
    actions.markAsNewAction.mockResolvedValue({ success: false, error: 'bad' });

    const enrichedRelease = {
      ...makeRelease(),
      isNew: false,
    };

    render(<ReleaseCardComponent enrichedRelease={enrichedRelease} settings={{ ...baseSettings, showMarkAsNew: true }} />);

    const markButton = getButtonBySpanText('Mark as new');
    markButton?.click();

    await Promise.resolve();
    await Promise.resolve();
    expect(actions.markAsNewAction).toHaveBeenCalledWith('owner/repo');
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Something went wrong',
        description: 'bad',
        variant: 'destructive',
      }),
    );
  });

  it('shows validation error when acknowledge action reports failure', async () => {
    networkState = { isOnline: true };
    const actions = await import('@/app/actions');
    actions.acknowledgeNewReleaseAction.mockResolvedValue({ success: false, error: 'nope' });

    const enrichedRelease = {
      ...makeRelease(),
      isNew: true,
    };

    render(<ReleaseCardComponent enrichedRelease={enrichedRelease} settings={baseSettings} />);

    const acknowledgeButton = getButtonBySpanText('Acknowledge release');
    acknowledgeButton?.click();

    await Promise.resolve();
    await Promise.resolve();
    expect(actions.acknowledgeNewReleaseAction).toHaveBeenCalledWith('owner/repo');
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Something went wrong',
        description: 'nope',
        variant: 'destructive',
      }),
    );
  });

  it('shows generic error toast when acknowledge action throws', async () => {
    networkState = { isOnline: true };
    const actions = await import('@/app/actions');
    actions.acknowledgeNewReleaseAction.mockRejectedValue(new Error('broken'));

    const enrichedRelease = {
      ...makeRelease(),
      isNew: true,
    };

    render(<ReleaseCardComponent enrichedRelease={enrichedRelease} settings={baseSettings} />);

    const acknowledgeButton = getButtonBySpanText('Acknowledge release');
    acknowledgeButton?.click();

    await Promise.resolve();
    await Promise.resolve();
    expect(actions.acknowledgeNewReleaseAction).toHaveBeenCalled();
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Something went wrong',
        description: 'Failed to acknowledge',
        variant: 'destructive',
      }),
    );
  });
});
