// @vitest-environment jsdom
import React from 'react';
import ReactDOM from 'react-dom/client';
import { flushSync } from 'react-dom';
import { describe, it, expect, vi } from 'vitest';
// We'll mock hook per test and import component dynamically

vi.mock('@/app/actions', () => ({
  refreshAndCheckAction: vi.fn().mockResolvedValue({ messageKey: 'toast_refresh_success_description' }),
}));

vi.mock('@/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

describe('AutoRefresher', () => {
  function mockIntervalImmediate() {
    let savedCb: Function | null = null;
    const si = vi.spyOn(global, 'setInterval' as any).mockImplementation((cb: any) => {
      savedCb = cb;
      cb();
      return 1 as any;
    });
    vi.spyOn(global, 'clearInterval' as any).mockImplementation(() => {});
    return { si, get cb() { return savedCb; } };
  }

  it('triggers refresh when online', async () => {
    vi.resetModules();
    // Immediate transitions
    vi.doMock('react', async (importOriginal) => {
      const actual: any = await importOriginal();
      return { ...actual, useTransition: () => [false, (cb: any) => cb()] };
    });
    vi.doMock('@/hooks/use-network', () => ({ useNetworkStatus: () => ({ isOnline: true }) }));
    vi.doMock('@/app/actions', () => ({ refreshAndCheckAction: vi.fn().mockResolvedValue({}) }));
    const routerRef = { refresh: vi.fn() };
    vi.doMock('@/navigation', () => ({ useRouter: () => routerRef }));
    const { AutoRefresher } = await import('@/components/auto-refresher');
    const { refreshAndCheckAction } = await import('@/app/actions');
    // routerRef used by component

    const { si } = mockIntervalImmediate();
    const div = document.createElement('div');
    document.body.appendChild(div);
    const root = ReactDOM.createRoot(div);
    Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true } as any);
    flushSync(() => {
      root.render(<AutoRefresher intervalMinutes={1} />);
    });
    // allow startTransition to schedule
    await Promise.resolve();
    await Promise.resolve();
    expect(refreshAndCheckAction).toHaveBeenCalledTimes(1);
    expect(routerRef.refresh).toHaveBeenCalledTimes(1);
    si.mockRestore();
  });

  it('skips refresh when offline', async () => {
    vi.resetModules();
    vi.doMock('react', async (importOriginal) => {
      const actual: any = await importOriginal();
      return { ...actual, useTransition: () => [false, (cb: any) => cb()] };
    });
    vi.doMock('@/hooks/use-network', () => ({ useNetworkStatus: () => ({ isOnline: false }) }));
    vi.doMock('@/app/actions', () => ({ refreshAndCheckAction: vi.fn().mockResolvedValue({}) }));
    const routerRef = { refresh: vi.fn() };
    vi.doMock('@/navigation', () => ({ useRouter: () => routerRef }));
    const { AutoRefresher } = await import('@/components/auto-refresher');
    const { refreshAndCheckAction } = await import('@/app/actions');

    const { si } = mockIntervalImmediate();
    const div = document.createElement('div');
    document.body.appendChild(div);
    const root = ReactDOM.createRoot(div);
    // Guard also uses navigator.onLine; ensure false
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true } as any);
    flushSync(() => {
      root.render(<AutoRefresher intervalMinutes={1} />);
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(refreshAndCheckAction).not.toHaveBeenCalled();
    expect(routerRef.refresh).not.toHaveBeenCalled();
    si.mockRestore();
  });
});
