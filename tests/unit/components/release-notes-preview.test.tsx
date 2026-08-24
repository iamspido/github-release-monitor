// @vitest-environment jsdom
import { act } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReleaseNotesPreview } from "@/components/release-notes-preview";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("ReleaseNotesPreview", () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders only provider-confirmed commit references as sanitized links", () => {
    const fullHash = "1234567890abcdef1234567890abcdef12345678";

    act(() => {
      root.render(
        <ReleaseNotesPreview
          body={`- ${fullHash} Confirmed\n- c0ffee1 Unconfirmed`}
          commitLinks={[
            {
              ref: fullHash,
              sha: fullHash,
              url: `https://github.com/new-owner/new-repo/commit/${fullHash}`,
            },
          ]}
        />,
      );
    });

    const commitLink = container.querySelector<HTMLAnchorElement>(
      `a[href="https://github.com/new-owner/new-repo/commit/${fullHash}"]`,
    );
    expect(commitLink?.querySelector("code")?.textContent).toBe("1234567");
    expect(container.textContent).toContain("c0ffee1 Unconfirmed");
    expect(container.querySelectorAll("a")).toHaveLength(1);
  });
});
