// @vitest-environment jsdom
import { flushSync } from "react-dom";
import ReactDOM from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

describe("RefreshButton reload handling", () => {
  it("reloads the page when the server action reference is stale", async () => {
    vi.resetModules();
    vi.doMock("react", async (importOriginal) => {
      const actual = await importOriginal<typeof import("react")>();
      return {
        ...actual,
        useTransition: () => [false, (cb: () => void) => cb()],
      };
    });
    vi.doMock("next-intl", () => ({
      useTranslations: () => (key: string) => key,
    }));
    const toastMock = vi.fn();
    vi.doMock("@/hooks/use-toast", () => ({
      useToast: () => ({ toast: toastMock }),
    }));
    vi.doMock("@/hooks/use-network", () => ({
      useNetworkStatus: () => ({ isOnline: true }),
    }));
    const routerRef = { refresh: vi.fn() };
    vi.doMock("@/i18n/navigation", () => ({ useRouter: () => routerRef }));
    const error = new Error('Failed to find Server Action "abc"');
    const actionMock = vi.fn().mockRejectedValue(error);
    vi.doMock("@/app/actions", () => ({
      refreshAndCheckAction: actionMock,
    }));
    const reloadStub = vi.fn().mockReturnValue(true);
    vi.doMock("@/lib/server-action-error", () => ({
      reloadIfServerActionStale: reloadStub,
    }));

    const { RefreshButton } = await import("@/components/refresh-button");
    const { reloadIfServerActionStale } = await import(
      "@/lib/server-action-error"
    );

    const div = document.createElement("div");
    document.body.appendChild(div);
    const root = ReactDOM.createRoot(div);
    try {
      flushSync(() => {
        root.render(<RefreshButton />);
      });
      const form = document.querySelector("form");
      if (!form) throw new Error("form not rendered");
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
      await Promise.resolve();
      expect(actionMock).toHaveBeenCalledTimes(1);
      expect(reloadIfServerActionStale).toHaveBeenCalledTimes(1);
      expect(reloadIfServerActionStale).toHaveBeenCalledWith(error);
      expect(routerRef.refresh).not.toHaveBeenCalled();
      expect(toastMock).not.toHaveBeenCalled();
    } finally {
      flushSync(() => {
        root.unmount();
      });
      div.remove();
    }
  });
});
