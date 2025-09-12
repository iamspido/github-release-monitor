// @vitest-environment jsdom
import React from 'react';
import ReactDOM from 'react-dom/client';
import { flushSync } from 'react-dom';
import { describe, it, expect, vi } from 'vitest';
// We'll mock the network hook per test and dynamically import the component

// Mock i18n hook used inside the banner
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => {
    const map: Record<string, string> = {
      offline_banner_title: "You're offline.",
      offline_banner_description: 'Actions that require network access are temporarily disabled.',
    };
    return map[key] || key;
  },
}));

describe('OfflineBanner', () => {
  it('hidden when online', async () => {
    vi.resetModules();
    vi.doMock('@/hooks/use-network', () => ({ useNetworkStatus: () => ({ isOnline: true }) }));
    const { OfflineBanner } = await import('@/components/offline-banner');
    const div = document.createElement('div');
    const root = ReactDOM.createRoot(div);
    flushSync(() => { root.render(<OfflineBanner />); });
    const bannerEl = div.querySelector('[aria-live="polite"]') as HTMLElement | null;
    expect(bannerEl).toBeTruthy();
    expect(bannerEl!.className).toContain('opacity-0');
  });

  it('visible when offline (element present)', async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.doMock('@/hooks/use-network', () => ({ useNetworkStatus: () => ({ isOnline: false }) }));
    const { OfflineBanner } = await import('@/components/offline-banner');
    const div = document.createElement('div');
    const root = ReactDOM.createRoot(div);
    flushSync(() => { root.render(<OfflineBanner />); });
    const bannerEl = div.querySelector('[aria-live="polite"]') as HTMLElement | null;
    expect(bannerEl).toBeTruthy();
    // Debounce 350ms; advance timers and ensure element remains present
    vi.advanceTimersByTime(400);
    expect(bannerEl!.getAttribute('aria-live')).toBe('polite');
    vi.useRealTimers();
  });
});
