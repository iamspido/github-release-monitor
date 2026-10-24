// @vitest-environment jsdom
import { flushSync } from "react-dom";
import ReactDOM from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

// Each test re-imports the hook module after vi.resetModules(), so the
// readout receives that fresh hook instead of capturing it in a closure.
function Readout({
  useNetworkStatus,
}: {
  useNetworkStatus: () => { isOnline: boolean };
}) {
  const { isOnline } = useNetworkStatus();
  return <span data-testid="net">{String(isOnline)}</span>;
}

describe("use-network (NetworkStatusProvider)", () => {
  afterEach(() => {
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: true,
    });
  });

  it("uses the current navigator state on first mount", async () => {
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: false,
    });
    vi.resetModules();
    const { NetworkStatusProvider, useNetworkStatus } = await import(
      "@/hooks/use-network"
    );
    const div = document.createElement("div");
    const root = ReactDOM.createRoot(div);
    try {
      flushSync(() => {
        root.render(
          <NetworkStatusProvider>
            <Readout useNetworkStatus={useNetworkStatus} />
          </NetworkStatusProvider>,
        );
      });

      expect(div.querySelector('[data-testid="net"]')?.textContent).toBe(
        "false",
      );
    } finally {
      flushSync(() => root.unmount());
    }
  });

  it("toggles on offline/online events", async () => {
    vi.resetModules();
    const { NetworkStatusProvider, useNetworkStatus } = await import(
      "@/hooks/use-network"
    );
    const div = document.createElement("div");
    const root = ReactDOM.createRoot(div);
    const span = () => {
      const element = div.querySelector(
        '[data-testid="net"]',
      ) as HTMLSpanElement | null;
      if (!element) throw new Error("Network status readout was not rendered");
      return element;
    };
    try {
      flushSync(() => {
        root.render(
          <NetworkStatusProvider>
            <Readout useNetworkStatus={useNetworkStatus} />
          </NetworkStatusProvider>,
        );
      });
      flushSync(() => {
        window.dispatchEvent(new Event("offline"));
      });
      expect(span().textContent).toBe("false");

      flushSync(() => {
        window.dispatchEvent(new Event("online"));
      });
      expect(span().textContent).toBe("true");
    } finally {
      flushSync(() => root.unmount());
    }
  });
});
