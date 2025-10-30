// @vitest-environment jsdom
import React from 'react';
import ReactDOM from 'react-dom/client';
import { flushSync } from 'react-dom';
import { describe, expect, it, vi } from 'vitest';

describe('useServerActionStaleReload', () => {
  function setup() {
    const div = document.createElement('div');
    document.body.appendChild(div);
    const root = ReactDOM.createRoot(div);
    return {
      div,
      root,
      cleanup() {
        flushSync(() => {
          root.unmount();
        });
        div.remove();
      },
    };
  }

  it('listens for unhandled rejections and triggers reload logic once', async () => {
    vi.resetModules();
    const reloadStub = vi.fn().mockReturnValue(true);
    const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.doMock('@/lib/server-action-error', () => ({
      reloadIfServerActionStale: reloadStub,
    }));
    const { useServerActionStaleReload } = await import('@/hooks/use-server-action-stale-reload');

    function TestHarness() {
      useServerActionStaleReload();
      return null;
    }

    const { root, cleanup } = setup();
    try {
      flushSync(() => {
        root.render(<TestHarness />);
      });

      const rejectedPromise = Promise.reject(new Error('boom'));
      rejectedPromise.catch(() => {});
      window.dispatchEvent(
        new PromiseRejectionEvent('unhandledrejection', {
          promise: rejectedPromise,
          reason: new Error('Failed to find Server Action "abc"'),
        }),
      );
      expect(reloadStub).toHaveBeenCalledTimes(1);
      expect(consoleInfoSpy).toHaveBeenCalledWith(
        '[GitHub Release Monitor] Reloading due to stale server action',
        expect.any(Error),
      );

      const anotherPromise = Promise.reject(new Error('boom-2'));
      anotherPromise.catch(() => {});
      window.dispatchEvent(
        new PromiseRejectionEvent('unhandledrejection', {
          promise: anotherPromise,
          reason: new Error('Failed to find Server Action "abc"'),
        }),
      );
      expect(reloadStub).toHaveBeenCalledTimes(1);
    } finally {
      consoleInfoSpy.mockRestore();
      cleanup();
    }
  });
});
