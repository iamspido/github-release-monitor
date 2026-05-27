// @vitest-environment jsdom
import { flushSync } from "react-dom";
import ReactDOM from "react-dom/client";
import { describe, expect, it } from "vitest";
import { NetworkStatusProvider, useNetworkStatus } from "@/hooks/use-network";

function Readout() {
  const { isOnline } = useNetworkStatus();
  return <span data-testid="net">{String(isOnline)}</span>;
}

describe("use-network (NetworkStatusProvider)", () => {
  it("toggles on offline/online events", () => {
    const div = document.createElement("div");
    const root = ReactDOM.createRoot(div);
    try {
      flushSync(() => {
        root.render(
          <NetworkStatusProvider>
            <Readout />
          </NetworkStatusProvider>,
        );
      });

      const span = () => {
        const element = div.querySelector(
          '[data-testid="net"]',
        ) as HTMLSpanElement | null;
        if (!element) {
          throw new Error("Network status readout was not rendered");
        }
        return element;
      };
      flushSync(() => {
        window.dispatchEvent(new Event("offline"));
      });
      expect(span().textContent).toBe("false");

      flushSync(() => {
        window.dispatchEvent(new Event("online"));
      });
      expect(span().textContent).toBe("true");
    } finally {
      flushSync(() => {
        root.unmount();
      });
    }
  });
});
