// @vitest-environment jsdom
import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings, Repository } from '@/types';

const translationMap: Record<string, Record<string, string>> = {
  RepoSettingsDialog: {
    title: 'Repository settings',
    autosave_waiting: 'Waiting to save…',
    autosave_saving: 'Saving…',
    autosave_success_short: 'Saved',
    autosave_error: 'Save failed',
    autosave_paused_offline: 'Offline – saving paused',
    toast_error_title: 'Save error',
    reset_to_global_button: 'Reset filters',
    reset_to_global_tooltip: 'Reset to global',
    releases_per_page_label_repo: 'Releases per page',
    releases_per_page_hint_global: 'Using global value',
    releases_per_page_hint_individual: 'Using custom value',
    regex_filter_title: 'Regex filter',
    channels_hint_global: 'Global channels',
    channels_hint_individual: 'Individual channels',
  },
  SettingsForm: {
    autosave_success: 'All changes saved',
    offline_notice:
      "Offline – this dialog is read-only. Changes will not be saved until you're back online.",
    release_channel_title: 'Channels',
    release_channel_description_repo: 'Pick channels',
    release_channel_stable: 'Stable',
    release_channel_prerelease: 'Prerelease',
    release_channel_draft: 'Draft',
    prerelease_subtype_description: 'Prerelease tags',
    regex_filter_description_repo: 'Filter releases',
    include_regex_label: 'Include regex',
    exclude_regex_label: 'Exclude regex',
    regex_placeholder: 'Regex…',
    regex_error_invalid: 'Invalid regular expression.',
  },
};

vi.mock('next-intl', () => ({
  useTranslations: (namespace: string) => {
    const dict = translationMap[namespace] ?? {};
    const translate = ((key: string) => dict[key] ?? `${namespace}.${key}`) as any;
    translate.rich = (key: string, values: Record<string, any>) => {
      const message = dict[key];
      if (!message) return `${namespace}.${key}`;
      if (!values) return message;
      return message.replace('{repoId}', values.repoId ? values.repoId() : '');
    };
    return translate;
  },
}));

let networkState = { isOnline: true };

vi.mock('@/hooks/use-network', () => ({
  useNetworkStatus: () => networkState,
}));

const toastSpy = vi.fn();

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({
    toasts: [],
    toast: toastSpy,
    dismiss: vi.fn(),
  }),
  toast: vi.fn(),
}));

let fakeSetTimeout: typeof globalThis.setTimeout;

vi.mock('@/components/ui/dialog', () => {
  const passthrough = ({ children, ...rest }: any) => <div {...rest}>{children}</div>;
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

const updateSettingsMock = vi.fn();

vi.mock('@/app/actions', async () => {
  const actual = await vi.importActual('@/app/actions');
  return {
    ...actual,
    updateRepositorySettingsAction: vi.fn((...args: any[]) => updateSettingsMock(...args)),
    refreshSingleRepositoryAction: vi.fn().mockResolvedValue({}),
  };
});

const baseSettings: AppSettings = {
  timeFormat: '24h',
  locale: 'en',
  refreshInterval: 5,
  cacheInterval: 5,
  releasesPerPage: 10,
  parallelRepoFetches: 3,
  releaseChannels: ['stable'],
};

const emptyRepoSettings: Pick<Repository, 'releaseChannels' | 'preReleaseSubChannels' | 'releasesPerPage' | 'includeRegex' | 'excludeRegex' | 'appriseTags' | 'appriseFormat'> = {
  releaseChannels: [],
  preReleaseSubChannels: [],
  releasesPerPage: null,
  includeRegex: undefined,
  excludeRegex: undefined,
  appriseTags: undefined,
  appriseFormat: undefined,
};

let RepoSettingsDialogComponent: typeof import('@/components/repo-settings-dialog').RepoSettingsDialog;

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('RepoSettingsDialog autosave behaviour', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeAll(async () => {
    const mod = await import('@/components/repo-settings-dialog');
    RepoSettingsDialogComponent = mod.RepoSettingsDialog;
  });

  beforeEach(() => {
    vi.useFakeTimers();
    fakeSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = ((cb: (...args: any[]) => any, delay?: number, ...args: any[]) =>
      fakeSetTimeout(async () => {
        await act(async () => {
          await cb(...args);
        });
      }, delay)) as typeof globalThis.setTimeout;
    networkState = { isOnline: true };
    toastSpy.mockClear();
    updateSettingsMock.mockReset();
    updateSettingsMock.mockResolvedValue({ success: true });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    globalThis.setTimeout = fakeSetTimeout;
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  function renderDialog(
    props?: Partial<React.ComponentProps<typeof import('@/components/repo-settings-dialog').RepoSettingsDialog>>,
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
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    if (descriptor?.set) {
      descriptor.set.call(input, value);
    } else {
      input.value = value;
    }
    input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true, composed: true }));
    input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
  }

  async function advanceAutosaveDelay(delay = 1500) {
    await act(async () => {
      vi.advanceTimersByTime(delay);
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
    throw lastError ?? new Error('Expectation not met');
  }

  async function getIncludeInput() {
    await flushEffects();
    const input = container.querySelector('input[id="include-regex-repo"]') as HTMLInputElement | null;
    if (!input) {
      throw new Error('include-regex-repo input not rendered');
    }
    return input;
  }

  it('pauses autosave when offline without calling update action', async () => {
    networkState = { isOnline: false };
    renderDialog();
    await flushEffects();
    expect(document.body.textContent).toContain(
      "Offline – this dialog is read-only. Changes will not be saved until you're back online.",
    );
    expect(updateSettingsMock).not.toHaveBeenCalled();
  });

  it('shows success and commits settings when autosave succeeds', async () => {
    updateSettingsMock.mockResolvedValueOnce({ success: true });

    renderDialog();
    const input = await getIncludeInput();
    await act(async () => {
      setInputValue(input, 'feature');
    });
    await flushEffects();

    await advanceAutosaveDelay();

    await act(async () => {
      await expectEventually(() => {
        expect(updateSettingsMock).toHaveBeenCalledWith(
          'owner/repo',
          expect.objectContaining({ includeRegex: 'feature' }),
        );
      });
    });
    await act(async () => {
      await expectEventually(() => {
        expect(document.body.textContent).toContain('Saved');
      });
    });
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it('blocks autosave when include regex becomes invalid', async () => {
    renderDialog();
    const input = await getIncludeInput();
    await act(async () => {
      setInputValue(input, '(');
    });
    await flushEffects();

    await advanceAutosaveDelay();

    await act(async () => {
      await expectEventually(() => {
        expect(document.body.textContent).toContain('Invalid regular expression.');
      });
    });
    expect(updateSettingsMock).not.toHaveBeenCalled();
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it('shows error toast when autosave returns failure', async () => {
    updateSettingsMock.mockResolvedValueOnce({ success: false, error: 'nope' });

    renderDialog();
    const input = await getIncludeInput();
    await act(async () => {
      setInputValue(input, 'feature');
    });
    await flushEffects();

    await advanceAutosaveDelay();

    await act(async () => {
      await expectEventually(() => {
        expect(toastSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'Save error',
            description: 'nope',
            variant: 'destructive',
          }),
        );
      });
    });
    expect(updateSettingsMock).toHaveBeenCalled();
  });

  it('shows error toast when autosave throws', async () => {
    updateSettingsMock.mockRejectedValueOnce(new Error('broken'));

    renderDialog();
    const input = await getIncludeInput();
    await act(async () => {
      setInputValue(input, 'feature');
    });
    await flushEffects();

    await advanceAutosaveDelay();

    await act(async () => {
      await expectEventually(() => {
        expect(toastSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'Save error',
            description: 'Error: broken',
            variant: 'destructive',
          }),
        );
      });
    });
    expect(updateSettingsMock).toHaveBeenCalled();
  });
});
