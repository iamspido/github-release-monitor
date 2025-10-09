// @vitest-environment jsdom
import React from 'react';
import ReactDOM from 'react-dom/client';
import { describe, it, expect, vi } from 'vitest';
import { SettingsForm } from '@/components/settings-form';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
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
  function renderForm(isOnline = true) {
    const div = document.createElement('div');
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
          releaseChannels: ['stable'],
          preReleaseSubChannels: undefined,
          showAcknowledge: true,
        } as any}
        isAppriseConfigured={true}
      />
    );
    return { div };
  }

  it('does not call updateSettingsAction while offline', async () => {
    vi.useFakeTimers();
    const { div } = renderForm(false);
    const { updateSettingsAction } = await import('@/app/settings/actions');
    // Trigger a change that would normally autosave
    const localeSelect = div.querySelector('#language-select');
    if (localeSelect) localeSelect.dispatchEvent(new Event('change', { bubbles: true }));
    vi.advanceTimersByTime(2000);
    expect(updateSettingsAction).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
