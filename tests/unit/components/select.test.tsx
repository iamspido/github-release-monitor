// @vitest-environment jsdom
import { act, type HTMLAttributes, type ReactNode } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface MockChildrenProps {
  children?: ReactNode;
}

type MockDivProps = HTMLAttributes<HTMLDivElement> & MockChildrenProps;

vi.mock("@radix-ui/react-select", async () => {
  const ReactModule = await import("react");
  const passthrough = ReactModule.forwardRef<HTMLDivElement, MockDivProps>(
    ({ children, ...props }, ref) => (
      <div ref={ref} {...props}>
        {children}
      </div>
    ),
  );
  passthrough.displayName = "Passthrough";

  return {
    Root: ({ children }: MockChildrenProps) => <>{children}</>,
    Group: passthrough,
    Value: () => null,
    Trigger: passthrough,
    Icon: ({ children }: MockChildrenProps) => <>{children}</>,
    Portal: ({ children }: MockChildrenProps) => <>{children}</>,
    Content: passthrough,
    Viewport: ReactModule.forwardRef<HTMLDivElement, MockDivProps>(
      ({ children, ...props }, ref) => (
        <div ref={ref} data-testid="select-viewport" {...props}>
          {children}
        </div>
      ),
    ),
    Label: passthrough,
    Item: passthrough,
    ItemIndicator: ({ children }: MockChildrenProps) => <>{children}</>,
    ItemText: ({ children }: MockChildrenProps) => <>{children}</>,
    Separator: passthrough,
  };
});

import { SelectContent } from "@/components/ui/select";

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("SelectContent", () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("caps long dropdowns and makes the viewport scrollable", () => {
    act(() => {
      root.render(
        <SelectContent>
          <div>Item</div>
        </SelectContent>,
      );
    });

    const content = container.firstElementChild as HTMLElement;
    const viewport = container.querySelector(
      '[data-testid="select-viewport"]',
    ) as HTMLElement;

    expect(content.className).toContain("max-h-64");
    expect(content.className).toContain("overflow-hidden");
    expect(viewport.className).toContain("max-h-64");
    expect(viewport.className).toContain("overflow-y-auto");
  });
});
