// @vitest-environment jsdom
import { act } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useBrowserTimeZone } from "@/hooks/use-browser-time-zone";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function TimeZoneReadout() {
  const timeZone = useBrowserTimeZone();
  return <span>{timeZone ?? "pending"}</span>;
}

describe("useBrowserTimeZone", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("falls back to UTC when the browser timezone cannot be resolved", async () => {
    vi.spyOn(Intl, "DateTimeFormat").mockImplementationOnce(() => {
      throw new RangeError("timezone unavailable");
    });
    const container = document.createElement("div");
    const root = ReactDOM.createRoot(container);

    try {
      await act(async () => {
        root.render(<TimeZoneReadout />);
        await Promise.resolve();
      });
      expect(container.textContent).toBe("UTC");
    } finally {
      act(() => root.unmount());
    }
  });
});
