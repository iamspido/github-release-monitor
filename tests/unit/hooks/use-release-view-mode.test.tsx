// @vitest-environment jsdom

import { act } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useReleaseViewMode } from "@/hooks/use-release-view-mode";
import {
  normalizeReleaseViewMode,
  RELEASE_VIEW_MODE_COOKIE,
  type ReleaseViewMode,
} from "@/lib/release-view-mode";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function ViewModeHarness({ initialMode }: { initialMode: ReleaseViewMode }) {
  const { updateViewMode, viewMode } = useReleaseViewMode(initialMode);

  return (
    <div>
      <output>{viewMode}</output>
      {(["cards", "compact"] satisfies ReleaseViewMode[]).map((mode) => (
        <button key={mode} type="button" onClick={() => updateViewMode(mode)}>
          {mode}
        </button>
      ))}
    </div>
  );
}

let container: HTMLDivElement;
let root: ReactDOM.Root;

beforeEach(() => {
  // biome-ignore lint/suspicious/noDocumentCookie: jsdom does not implement the Cookie Store API used by browsers.
  document.cookie = `${RELEASE_VIEW_MODE_COOKIE}=; Path=/; Max-Age=0`;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = ReactDOM.createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function renderHarness(initialMode: ReleaseViewMode = "cards") {
  act(() => root.render(<ViewModeHarness initialMode={initialMode} />));
}

describe("useReleaseViewMode", () => {
  it("uses cards as the default view", () => {
    renderHarness();

    expect(container.querySelector("output")?.textContent).toBe("cards");
  });

  it("uses the server-provided view and persists updates in a cookie", () => {
    renderHarness("compact");

    expect(container.querySelector("output")?.textContent).toBe("compact");

    const cardsButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "cards",
    );
    act(() => cardsButton?.click());

    expect(container.querySelector("output")?.textContent).toBe("cards");
    expect(document.cookie).toContain(`${RELEASE_VIEW_MODE_COOKIE}=cards`);
  });

  it("normalizes unsupported server cookie values", () => {
    expect(normalizeReleaseViewMode("table")).toBe("cards");
    expect(normalizeReleaseViewMode("compact")).toBe("compact");
  });
});
