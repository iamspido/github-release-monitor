// @vitest-environment jsdom
import React from 'react';
import ReactDOM from 'react-dom/client';
import { describe, it, expect, vi } from 'vitest';
import { SettingsForm } from '@/components/settings-form';

vi.mock('next-intl', () => ({
  useTranslations: () => ((key: string) => key),
}));

vi.mock('@/app/settings/actions', () => ({
  updateSettingsAction: vi.fn().mockResolvedValue({ success: true, message: { title: 'ok', description: 'ok' } }),
  deleteAllRepositoriesAction: vi.fn().mockResolvedValue({ success: true, message: { title: 'ok', description: 'ok' } }),
}));

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn() }),
}));

describe('SettingsForm offline autosave paused', () => {
  function renderForm(isOnline = true, isTokenSet = false, parallelFetches = 1) {
    const div = document.createElement('div');
    document.body.appendChild(div);
    const root = ReactDOM.createRoot(div);
    window.dispatchEvent(new Event(isOnline ? 'online' : 'offline'));
    root.render(
      <SettingsForm
        currentSettings={{
          timeFormat: '24h',
          locale: 'en',
          refreshInterval: 10,
          cacheInterval: 5,
          releasesPerPage: 30,
          parallelRepoFetches: parallelFetches,
          releaseChannels: ['stable'],
          preReleaseSubChannels: undefined,
          showAcknowledge: true,
        } as any}
        isAppriseConfigured={true}
        isGithubTokenSet={isTokenSet}
      />
    );
    return {
      div,
      cleanup: () => {
        root.unmount();
        div.remove();
      },
    };
  }

  it('does not call updateSettingsAction while offline', async () => {
    vi.useFakeTimers();
    const { div, cleanup } = renderForm(false);
    try {
      const { updateSettingsAction } = await import('@/app/settings/actions');
      // Trigger a change that would normally autosave
      const localeSelect = div.querySelector('#language-select');
      if (localeSelect) localeSelect.dispatchEvent(new Event('change', { bubbles: true }));
      vi.advanceTimersByTime(2000);
      expect(updateSettingsAction).not.toHaveBeenCalled();
    } finally {
      cleanup();
      vi.useRealTimers();
    }
  });

  it('shows warnings when parallel fetches exceed thresholds without token', async () => {
    const { div, cleanup } = renderForm(true, false, 25);
    try {
      await new Promise(resolve => setTimeout(resolve, 0));

      const text = div.textContent ?? '';
      expect(text).toContain('parallel_repo_fetches_warning_token');
      expect(text).toContain('parallel_repo_fetches_warning_high');
    } finally {
      cleanup();
    }
  });
});
