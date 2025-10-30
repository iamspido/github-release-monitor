// @vitest-environment jsdom
import React from 'react';
import ReactDOM from 'react-dom/client';
import { flushSync } from 'react-dom';
import { describe, it, expect, vi } from 'vitest';
// We'll mock hook per test and import component dynamically

vi.mock('@/app/actions', () => ({
  refreshAndCheckAction: vi.fn().mockResolvedValue({ messageKey: 'toast_refresh_success_description' }),
}));

vi.mock('@/i18n/navigation', () => ({
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
    const ci = vi.spyOn(global, 'clearInterval' as any).mockImplementation(() => {});
    return {
      si,
      ci,
      get cb() {
        return savedCb;
      },
      restore: () => {
        si.mockRestore();
        ci.mockRestore();
      },
    };
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
    vi.doMock('@/i18n/navigation', () => ({ useRouter: () => routerRef }));
    const { AutoRefresher } = await import('@/components/auto-refresher');
    const { refreshAndCheckAction } = await import('@/app/actions');
    // routerRef used by component

    const { restore } = mockIntervalImmediate();
    const div = document.createElement('div');
    document.body.appendChild(div);
    const root = ReactDOM.createRoot(div);
    const originalOnLine = Object.getOwnPropertyDescriptor(window.navigator, 'onLine');
    Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true } as any);
    try {
      flushSync(() => {
        root.render(<AutoRefresher intervalMinutes={1} />);
      });
      // allow startTransition to schedule
      await Promise.resolve();
      await Promise.resolve();
      expect(refreshAndCheckAction).toHaveBeenCalledTimes(1);
      expect(routerRef.refresh).toHaveBeenCalledTimes(1);
    } finally {
      flushSync(() => { root.unmount(); });
      div.remove();
      if (originalOnLine) {
        Object.defineProperty(window.navigator, 'onLine', originalOnLine);
      } else {
        delete (window.navigator as any).onLine;
      }
      restore();
    }
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
    vi.doMock('@/i18n/navigation', () => ({ useRouter: () => routerRef }));
    const { AutoRefresher } = await import('@/components/auto-refresher');
    const { refreshAndCheckAction } = await import('@/app/actions');

    const { restore } = mockIntervalImmediate();
    const div = document.createElement('div');
    document.body.appendChild(div);
    const root = ReactDOM.createRoot(div);
    // Guard also uses navigator.onLine; ensure false
    const originalOnLine = Object.getOwnPropertyDescriptor(window.navigator, 'onLine');
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true } as any);
    try {
      flushSync(() => {
        root.render(<AutoRefresher intervalMinutes={1} />);
      });
      await Promise.resolve();
      await Promise.resolve();
      expect(refreshAndCheckAction).not.toHaveBeenCalled();
      expect(routerRef.refresh).not.toHaveBeenCalled();
    } finally {
      flushSync(() => { root.unmount(); });
      div.remove();
      if (originalOnLine) {
        Object.defineProperty(window.navigator, 'onLine', originalOnLine);
      } else {
        delete (window.navigator as any).onLine;
      }
      restore();
    }
  });

  it('reloads the page when a stale server action error occurs', async () => {
    vi.resetModules();
    vi.doMock('react', async (importOriginal) => {
      const actual: any = await importOriginal();
      return { ...actual, useTransition: () => [false, (cb: any) => cb()] };
    });
    vi.doMock('@/hooks/use-network', () => ({ useNetworkStatus: () => ({ isOnline: true }) }));
    const error = new Error('Failed to find Server Action "abc"');
    vi.doMock('@/app/actions', () => ({ refreshAndCheckAction: vi.fn().mockRejectedValue(error) }));
    const reloadStub = vi.fn().mockReturnValue(true);
    vi.doMock('@/lib/server-action-error', () => ({
      reloadIfServerActionStale: reloadStub,
    }));
    const routerRef = { refresh: vi.fn() };
    vi.doMock('@/i18n/navigation', () => ({ useRouter: () => routerRef }));
    const { AutoRefresher } = await import('@/components/auto-refresher');
    const { reloadIfServerActionStale } = await import('@/lib/server-action-error');

    const { restore } = mockIntervalImmediate();
    const div = document.createElement('div');
    document.body.appendChild(div);
    const root = ReactDOM.createRoot(div);
    const originalOnLine = Object.getOwnPropertyDescriptor(window.navigator, 'onLine');
    Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true } as any);
    try {
      flushSync(() => {
        root.render(<AutoRefresher intervalMinutes={1} />);
      });
      await Promise.resolve();
      await Promise.resolve();
      expect(reloadIfServerActionStale).toHaveBeenCalledTimes(1);
      expect(reloadIfServerActionStale).toHaveBeenCalledWith(error);
      expect(routerRef.refresh).not.toHaveBeenCalled();
    } finally {
      flushSync(() => { root.unmount(); });
      div.remove();
      if (originalOnLine) {
        Object.defineProperty(window.navigator, 'onLine', originalOnLine);
      } else {
        delete (window.navigator as any).onLine;
      }
      restore();
    }
  });
});
