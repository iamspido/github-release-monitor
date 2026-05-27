// @vitest-environment jsdom
import { flushSync } from "react-dom";
import ReactDOM from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

// We'll mock hook per test and import component dynamically

vi.mock("@/app/actions", () => ({
  refreshDueRepositoriesAction: vi
    .fn()
    .mockResolvedValue({ messageKey: "toast_refresh_success_description" }),
}));

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

describe("AutoRefresher", () => {
  function mockIntervalImmediate() {
    let savedCb: (() => void) | null = null;
    const si = vi
      .spyOn(globalThis, "setInterval")
      .mockImplementation((cb: TimerHandler) => {
        if (typeof cb !== "function") {
          throw new Error("Expected function interval handler");
        }
        savedCb = cb;
        cb();
        return 1 as unknown as ReturnType<typeof setInterval>;
      });
    const ci = vi
      .spyOn(globalThis, "clearInterval")
      .mockImplementation(() => {});
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

  it("triggers refresh when online", async () => {
    vi.resetModules();
    // Immediate transitions
    vi.doMock("react", async (importOriginal) => {
      const actual = await importOriginal<typeof import("react")>();
      return {
        ...actual,
        useTransition: () => [false, (cb: () => void) => cb()],
      };
    });
    vi.doMock("@/hooks/use-network", () => ({
      useNetworkStatus: () => ({ isOnline: true }),
    }));
    vi.doMock("@/app/actions", () => ({
      refreshDueRepositoriesAction: vi.fn().mockResolvedValue({}),
    }));
    const routerRef = { refresh: vi.fn() };
    vi.doMock("@/i18n/navigation", () => ({ useRouter: () => routerRef }));
    const { AutoRefresher } = await import("@/components/auto-refresher");
    const { refreshDueRepositoriesAction } = await import("@/app/actions");
    // routerRef used by component

    const { restore } = mockIntervalImmediate();
    const div = document.createElement("div");
    document.body.appendChild(div);
    const root = ReactDOM.createRoot(div);
    const originalOnLine = Object.getOwnPropertyDescriptor(
      window.navigator,
      "onLine",
    );
    Object.defineProperty(window.navigator, "onLine", {
      value: true,
      configurable: true,
    });
    try {
      flushSync(() => {
        root.render(<AutoRefresher intervalMinutes={1} />);
      });
      // allow startTransition to schedule
      await Promise.resolve();
      await Promise.resolve();
      expect(refreshDueRepositoriesAction).toHaveBeenCalledTimes(1);
      expect(routerRef.refresh).toHaveBeenCalledTimes(1);
    } finally {
      flushSync(() => {
        root.unmount();
      });
      div.remove();
      if (originalOnLine) {
        Object.defineProperty(window.navigator, "onLine", originalOnLine);
      } else {
        delete (window.navigator as Navigator & { onLine?: boolean }).onLine;
      }
      restore();
    }
  });

  it("skips refresh when offline", async () => {
    vi.resetModules();
    vi.doMock("react", async (importOriginal) => {
      const actual = await importOriginal<typeof import("react")>();
      return {
        ...actual,
        useTransition: () => [false, (cb: () => void) => cb()],
      };
    });
    vi.doMock("@/hooks/use-network", () => ({
      useNetworkStatus: () => ({ isOnline: false }),
    }));
    vi.doMock("@/app/actions", () => ({
      refreshDueRepositoriesAction: vi.fn().mockResolvedValue({}),
    }));
    const routerRef = { refresh: vi.fn() };
    vi.doMock("@/i18n/navigation", () => ({ useRouter: () => routerRef }));
    const { AutoRefresher } = await import("@/components/auto-refresher");
    const { refreshDueRepositoriesAction } = await import("@/app/actions");

    const { restore } = mockIntervalImmediate();
    const div = document.createElement("div");
    document.body.appendChild(div);
    const root = ReactDOM.createRoot(div);
    // Guard also uses navigator.onLine; ensure false
    const originalOnLine = Object.getOwnPropertyDescriptor(
      window.navigator,
      "onLine",
    );
    Object.defineProperty(window.navigator, "onLine", {
      value: false,
      configurable: true,
    });
    try {
      flushSync(() => {
        root.render(<AutoRefresher intervalMinutes={1} />);
      });
      await Promise.resolve();
      await Promise.resolve();
      expect(refreshDueRepositoriesAction).not.toHaveBeenCalled();
      expect(routerRef.refresh).not.toHaveBeenCalled();
    } finally {
      flushSync(() => {
        root.unmount();
      });
      div.remove();
      if (originalOnLine) {
        Object.defineProperty(window.navigator, "onLine", originalOnLine);
      } else {
        delete (window.navigator as Navigator & { onLine?: boolean }).onLine;
      }
      restore();
    }
  });

  it("reloads the page when a stale server action error occurs", async () => {
    vi.resetModules();
    vi.doMock("react", async (importOriginal) => {
      const actual = await importOriginal<typeof import("react")>();
      return {
        ...actual,
        useTransition: () => [false, (cb: () => void) => cb()],
      };
    });
    vi.doMock("@/hooks/use-network", () => ({
      useNetworkStatus: () => ({ isOnline: true }),
    }));
    const error = new Error('Failed to find Server Action "abc"');
    vi.doMock("@/app/actions", () => ({
      refreshDueRepositoriesAction: vi.fn().mockRejectedValue(error),
    }));
    const reloadStub = vi.fn().mockReturnValue(true);
    vi.doMock("@/lib/server-action-error", () => ({
      reloadIfServerActionStale: reloadStub,
    }));
    const routerRef = { refresh: vi.fn() };
    vi.doMock("@/i18n/navigation", () => ({ useRouter: () => routerRef }));
    const { AutoRefresher } = await import("@/components/auto-refresher");
    const { reloadIfServerActionStale } = await import(
      "@/lib/server-action-error"
    );

    const { restore } = mockIntervalImmediate();
    const div = document.createElement("div");
    document.body.appendChild(div);
    const root = ReactDOM.createRoot(div);
    const originalOnLine = Object.getOwnPropertyDescriptor(
      window.navigator,
      "onLine",
    );
    Object.defineProperty(window.navigator, "onLine", {
      value: true,
      configurable: true,
    });
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
      flushSync(() => {
        root.unmount();
      });
      div.remove();
      if (originalOnLine) {
        Object.defineProperty(window.navigator, "onLine", originalOnLine);
      } else {
        delete (window.navigator as Navigator & { onLine?: boolean }).onLine;
      }
      restore();
    }
  });
});
