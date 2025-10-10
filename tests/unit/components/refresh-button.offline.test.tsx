// @vitest-environment jsdom
import React from 'react';
import ReactDOM from 'react-dom/client';
import { flushSync } from 'react-dom';
import { describe, it, expect, vi } from 'vitest';
// We'll mock network and import dynamically

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => (key === 'refresh' ? 'Refresh' : key),
}));

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock('@/app/actions', () => ({
  refreshAndCheckAction: vi.fn().mockResolvedValue({ messageKey: 'toast_refresh_success_description' }),
}));

describe('RefreshButton disabled offline', () => {
  it('button disabled when offline', async () => {
    vi.resetModules();
    vi.doMock('@/hooks/use-network', () => ({ useNetworkStatus: () => ({ isOnline: false }) }));
    vi.doMock('next-intl', () => ({
      useTranslations: () => (key: string) => (key === 'refresh' ? 'Refresh' : key),
    }));
    vi.doMock('@/i18n/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
    vi.doMock('@/app/actions', () => ({ refreshAndCheckAction: vi.fn().mockResolvedValue({}) }));
    const { RefreshButton } = await import('@/components/refresh-button');
    const div = document.createElement('div');
    document.body.appendChild(div);
    const root = ReactDOM.createRoot(div);
    try {
      flushSync(() => { root.render(<RefreshButton />); });
      await Promise.resolve();
      const btn = document.querySelector('button[type="submit"]');
      expect(btn).toBeTruthy();
      expect((btn as HTMLButtonElement).disabled).toBe(true);
    } finally {
      flushSync(() => { root.unmount(); });
      div.remove();
    }
  });
});
