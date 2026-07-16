// @vitest-environment jsdom
import { act } from "react";
import ReactDOM from "react-dom/client";

import { useSharedMinuteTicker } from "@/hooks/use-shared-minute-ticker";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function TickerValue() {
  return <span>{useSharedMinuteTicker()}</span>;
}

describe("useSharedMinuteTicker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("refreshes its snapshot when subscribers return after an idle period", () => {
    const firstContainer = document.createElement("div");
    const firstRoot = ReactDOM.createRoot(firstContainer);
    act(() => firstRoot.render(<TickerValue />));
    act(() => firstRoot.unmount());

    vi.setSystemTime(new Date("2024-01-01T12:05:00.000Z"));

    const secondContainer = document.createElement("div");
    const secondRoot = ReactDOM.createRoot(secondContainer);
    act(() => secondRoot.render(<TickerValue />));

    expect(secondContainer.textContent).toBe(
      String(new Date("2024-01-01T12:05:00.000Z").getTime()),
    );

    act(() => secondRoot.unmount());
  });
});
