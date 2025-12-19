// @vitest-environment jsdom
import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('next-intl', () => ({
  useTranslations: (ns?: string) => {
    const maps: Record<string, Record<string, string>> = {
      RepoSettingsDialog: {
        title: 'Repository Settings',
        reset_to_global_button: 'Reset',
        description_flexible: 'Customize settings for <repoId></repoId>.',
        autosave_waiting: 'Waiting...',
        autosave_saving: 'Saving...',
        autosave_success: 'All changes saved',
        autosave_success_short: 'Saved',
        releases_per_page_label_repo: 'Releases per page',
      },
      SettingsForm: {
        offline_notice: 'Offline – changes are read-only and auto-save is paused.',
        apprise_format_text: 'Text',
        apprise_format_markdown: 'Markdown',
        apprise_format_html: 'HTML',
        autosave_success: 'All changes saved',
      },
    };
    const fn = (key: string) => maps[ns || '']?.[key] || key;
    (fn as any).rich = (key: string, { repoId }: { repoId: any }) => {
      const template = maps[ns || '']?.[key] || key;
      const parts = template.split('<repoId></repoId>');
      if (parts.length === 1) return template;
      return (
        <>
          {parts[0]}
          {repoId()}
          {parts.slice(1).join('')}
        </>
      );
    };
    return fn as any;
  },
}));

vi.mock('@/app/actions', () => ({
  updateRepositorySettingsAction: vi.fn().mockResolvedValue({ success: true }),
  refreshSingleRepositoryAction: vi.fn().mockResolvedValue({}),
}));

let networkState = { isOnline: true };

vi.mock('@/hooks/use-network', () => ({
  useNetworkStatus: () => networkState,
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({
    toasts: [],
    toast: vi.fn(),
    dismiss: vi.fn(),
  }),
  toast: vi.fn(),
}));

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

vi.mock('@/components/ui/tooltip', () => {
  const passthrough = ({ children, ...rest }: any) => <div {...rest}>{children}</div>;
  const passthroughChild = ({ children }: any) => <>{children}</>;
  return {
    TooltipProvider: passthroughChild,
    Tooltip: passthroughChild,
    TooltipTrigger: passthroughChild,
    TooltipContent: passthrough,
  };
});

vi.mock('@/components/ui/select', () => {
  const passthrough = ({ children, ...rest }: any) => <div {...rest}>{children}</div>;
  return {
    Select: passthrough,
    SelectTrigger: passthrough,
    SelectContent: passthrough,
    SelectItem: passthrough,
    SelectValue: passthrough,
  };
});

vi.mock('@/components/ui/alert-dialog', () => {
  const passthrough = ({ children, ...rest }: any) => <div {...rest}>{children}</div>;
  const passthroughChild = ({ children }: any) => <>{children}</>;
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

vi.mock('@/components/ui/checkbox', () => ({
  Checkbox: ({ checked, onCheckedChange, ...props }: any) => (
    <input type="checkbox" checked={checked} onChange={() => onCheckedChange?.(!checked)} {...props} />
  ),
}));

import { RepoSettingsDialog } from '@/components/repo-settings-dialog';

describe('RepoSettingsDialog offline behavior', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  function renderDialog() {
    act(() => {
      root.render(
        <RepoSettingsDialog
          isOpen={true}
          setIsOpen={() => {}}
          repoId="test/test"
          currentRepoSettings={undefined}
          globalSettings={{
            timeFormat: '24h',
            locale: 'en',
            refreshInterval: 10,
            cacheInterval: 5,
            releasesPerPage: 30,
            parallelRepoFetches: 5,
            releaseChannels: ['stable'],
            preReleaseSubChannels: undefined,
            showAcknowledge: true,
          } as any}
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
      'value',
    );
    if (descriptor?.set) {
      descriptor.set.call(input, value);
    } else {
      input.value = value;
    }
    input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true, composed: true }));
    input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
  }

  beforeEach(() => {
    networkState = { isOnline: true };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.clearAllMocks();
  });

  it('shows offline notice and reset button disabled', async () => {
    networkState = { isOnline: false };
    renderDialog();
    await flushEffects();

    expect(container.textContent ?? '').toContain(
      'Offline – changes are read-only and auto-save is paused.',
    );

    const resetButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Reset'),
    );
    expect(resetButton).toBeTruthy();
    expect(resetButton?.disabled).toBe(true);
  });

  it('online change triggers autosave after debounce', async () => {
    vi.useFakeTimers();
    try {
      networkState = { isOnline: true };
      renderDialog();
      await flushEffects();
      
      const labels = Array.from(document.querySelectorAll('label'));
      const releasesPerPageLabel = labels.find(label => 
        label.textContent?.includes('Releases per page')
      );
      
      let rpp: HTMLInputElement | null = null;
      if (releasesPerPageLabel && releasesPerPageLabel.htmlFor) {
        rpp = document.getElementById(releasesPerPageLabel.htmlFor) as HTMLInputElement;
      }
      
      // Fallback: find by type="number" if label approach fails
      if (!rpp) {
        const numberInputs = Array.from(document.querySelectorAll('input[type="number"]'));
        rpp = numberInputs[0] as HTMLInputElement;
      }
      
      expect(rpp).toBeTruthy();
      act(() => {
        setInputValue(rpp!, '7');
      });

      await flushEffects();
      
      await act(async () => {
        vi.advanceTimersByTime(1600);
        await Promise.resolve();
        await Promise.resolve();
      });
      await flushEffects();
      
      const { updateRepositorySettingsAction } = await import('@/app/actions');
      expect(updateRepositorySettingsAction).toHaveBeenCalled();
      expect(rpp!.value).toBe('7');
    } finally {
      vi.useRealTimers();
    }
  });
});
