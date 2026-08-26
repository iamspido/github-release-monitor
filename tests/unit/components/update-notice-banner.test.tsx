// @vitest-environment jsdom
import { act } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UpdateNotificationState } from "@/types";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  dismiss: vi.fn(),
  pendingAction: Promise.resolve() as Promise<void>,
}));

const originalEventSource = globalThis.EventSource;

class MockEventSource {
  static instances: MockEventSource[] = [];
  listeners = new Map<string, Array<(event: MessageEvent) => void>>();

  constructor() {
    MockEventSource.instances.push(this);
  }

  addEventListener(event: string, listener: (event: MessageEvent) => void) {
    const current = this.listeners.get(event) ?? [];
    current.push(listener);
    this.listeners.set(event, current);
  }

  close() {}
}

(globalThis as { EventSource?: typeof EventSource }).EventSource =
  MockEventSource as unknown as typeof EventSource;

const eventSourceInstances = {
  get latest() {
    return MockEventSource.instances.at(-1);
  },
  reset() {
    MockEventSource.instances.length = 0;
  },
};

vi.mock("next-intl", () => ({
  useTranslations:
    () => (key: string, values?: Record<string, string | null>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
}));

vi.mock("@/app/actions", () => ({
  dismissUpdateNotificationAction: (
    version: string,
    securityVersion: string | null,
  ) => mocks.dismiss(version, securityVersion),
}));

vi.mock("@/hooks/use-action-transition", () => ({
  useActionTransition: () => ({
    isPending: false,
    runAction: (
      action: () => Promise<void>,
      onError?: (error: unknown) => void,
    ) => {
      mocks.pendingAction = action().catch((error) => {
        onError?.(error);
      });
    },
  }),
}));

const mounted: Array<{ container: HTMLDivElement; root: ReactDOM.Root }> = [];

function createNotice(
  overrides: Partial<UpdateNotificationState> = {},
): UpdateNotificationState {
  return {
    latestVersion: "2.4.0",
    latestReleaseTitle: "Version 2.4.0",
    latestSecurityVersion: null,
    currentVersion: "2.3.0",
    lastCheckedAt: "2026-07-27T12:00:00.000Z",
    lastCheckError: null,
    hasUpdate: true,
    isDismissed: false,
    isSecurityUpdate: false,
    shouldNotify: true,
    ...overrides,
  };
}

async function renderBanner(props: {
  notice?: UpdateNotificationState;
  canDismiss?: boolean;
}) {
  const { UpdateNoticeBanner } = await import(
    "@/components/update-notice-banner"
  );
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);
  mounted.push({ container, root });
  await act(async () => {
    root.render(<UpdateNoticeBanner {...props} />);
  });
  return container;
}

async function rerenderBanner(
  container: HTMLDivElement,
  props: {
    notice?: UpdateNotificationState;
    canDismiss?: boolean;
  },
) {
  const mountedBanner = mounted.find((entry) => entry.container === container);
  if (!mountedBanner) {
    throw new Error("Banner is not mounted");
  }
  const { UpdateNoticeBanner } = await import(
    "@/components/update-notice-banner"
  );
  await act(async () => {
    mountedBanner.root.render(<UpdateNoticeBanner {...props} />);
  });
}

describe("UpdateNoticeBanner", () => {
  beforeEach(() => {
    (globalThis as { EventSource?: typeof EventSource }).EventSource =
      MockEventSource as unknown as typeof EventSource;
    eventSourceInstances.reset();
    vi.clearAllMocks();
    mocks.dismiss.mockResolvedValue({ success: true });
    mocks.pendingAction = Promise.resolve();
  });

  afterEach(() => {
    (globalThis as { EventSource?: typeof EventSource }).EventSource =
      originalEventSource;
    for (const { container, root } of mounted.splice(0)) {
      act(() => root.unmount());
      container.remove();
    }
  });

  it("stays hidden without an active notification", async () => {
    const absent = await renderBanner({});
    expect(absent.textContent).toBe("");

    const inactive = await renderBanner({
      notice: createNotice({ shouldNotify: false }),
    });
    expect(inactive.textContent).toBe("");
  });

  it("renders a safe release link and supports a non-dismissible mode", async () => {
    const container = await renderBanner({
      notice: createNotice({ latestVersion: " v2.4.0/rc 1 " }),
      canDismiss: false,
    });

    const link = container.querySelector("a");
    expect(link?.href).toBe(
      "https://github.com/iamspido/github-release-monitor/releases/tag/v2.4.0%2Frc%201",
    );
    expect(link?.target).toBe("_blank");
    expect(link?.rel).toBe("noopener noreferrer");
    expect(container.querySelector("button")).toBeNull();
    expect(container.textContent).toContain("\u2066 v2.4.0/rc 1 \u2069");
    expect(container.textContent).toContain("\u20662.3.0\u2069");
  });

  it("renders security updates prominently with their release title", async () => {
    const container = await renderBanner({
      notice: createNotice({
        latestReleaseTitle: "Security fixes for authentication",
        latestSecurityVersion: "2.4.0",
        isSecurityUpdate: true,
      }),
    });

    const banner = container.firstElementChild;
    expect(banner?.getAttribute("role")).toBe("status");
    expect(banner?.className).toContain("border-red-400");
    expect(container.textContent).toContain("security_release_badge");
    expect(container.textContent).toContain(
      "Security fixes for authentication",
    );

    await act(async () => {
      container.querySelector("button")?.click();
      await mocks.pendingAction;
    });
    expect(mocks.dismiss).toHaveBeenCalledWith("2.4.0", "2.4.0");
  });

  it("shows the latest security version when the newest release is regular", async () => {
    const container = await renderBanner({
      notice: createNotice({
        latestVersion: "v2.5.0",
        latestReleaseTitle: "Regular maintenance release",
        latestSecurityVersion: "v2.4.0",
        isSecurityUpdate: true,
      }),
    });

    expect(container.firstElementChild?.getAttribute("role")).toBe("status");
    expect(container.textContent).toContain("security_release_badge");
    expect(container.textContent).toContain("\u2066v2.4.0\u2069");
    expect(container.textContent).toContain("\u2066v2.5.0\u2069");
    expect(container.querySelector(".normal-case")?.textContent).toBe(
      "\u2066v2.4.0\u2069",
    );

    await act(async () => {
      container.querySelector("button")?.click();
      await mocks.pendingAction;
    });
    expect(mocks.dismiss).toHaveBeenCalledWith("v2.5.0", "v2.4.0");
  });

  it("hides itself after a successful dismissal", async () => {
    const container = await renderBanner({ notice: createNotice() });
    const dismissButton = container.querySelector("button");
    expect(dismissButton?.textContent).toContain("dismiss_label");

    await act(async () => {
      dismissButton?.click();
      await mocks.pendingAction;
    });

    expect(mocks.dismiss).toHaveBeenCalledWith("2.4.0", null);
    expect(container.textContent).toBe("");
  });

  it("shows itself again when a newer version arrives after a local dismissal", async () => {
    const container = await renderBanner({ notice: createNotice() });

    await act(async () => {
      container.querySelector("button")?.click();
      await mocks.pendingAction;
    });
    expect(container.textContent).toBe("");

    await rerenderBanner(container, {
      notice: createNotice({ latestVersion: "2.5.0" }),
    });

    expect(container.textContent).toContain("\u20662.5.0\u2069");
  });

  it("shows itself again when the same version becomes a security update", async () => {
    const container = await renderBanner({ notice: createNotice() });

    await act(async () => {
      container.querySelector("button")?.click();
      await mocks.pendingAction;
    });
    expect(container.textContent).toBe("");

    await rerenderBanner(container, {
      notice: createNotice({
        latestReleaseTitle: "Security fixes added to the release notes",
        latestSecurityVersion: "2.4.0",
        isSecurityUpdate: true,
      }),
    });

    expect(container.firstElementChild?.getAttribute("role")).toBe("status");
    expect(container.textContent).toContain(
      "Security fixes added to the release notes",
    );
  });

  it("remains visible when dismissal is rejected by the server", async () => {
    mocks.dismiss.mockResolvedValueOnce({ success: false });
    const container = await renderBanner({ notice: createNotice() });
    const dismissButton = container.querySelector("button");

    await act(async () => {
      dismissButton?.click();
      await mocks.pendingAction;
    });

    expect(mocks.dismiss).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("dismiss_label");
  });

  it("refreshes the notice from server-sent events without a reload", async () => {
    const securityNotice = createNotice({
      latestReleaseTitle: "Security fixes added to the release notes",
      latestSecurityVersion: "2.4.0",
      isSecurityUpdate: true,
    });

    eventSourceInstances.reset();
    const container = await renderBanner({ notice: createNotice() });
    expect(container.textContent).not.toContain(
      "Security fixes added to the release notes",
    );

    await act(async () => {
      for (const listener of eventSourceInstances.latest?.listeners.get(
        "update-notice-changed",
      ) ?? []) {
        listener({
          data: JSON.stringify(securityNotice),
        } as MessageEvent);
      }
    });
    expect(container.textContent).toContain("security_release_badge");
  });

  it("remains visible and reports an unexpected dismissal error", async () => {
    const error = new Error("dismiss unavailable");
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    mocks.dismiss.mockRejectedValueOnce(error);
    const container = await renderBanner({ notice: createNotice() });
    const dismissButton = container.querySelector("button");

    await act(async () => {
      dismissButton?.click();
      await mocks.pendingAction;
    });

    expect(mocks.dismiss).toHaveBeenCalledOnce();
    expect(consoleError).toHaveBeenCalledWith(
      "Failed to dismiss update notice:",
      error,
    );
    expect(container.textContent).toContain("dismiss_label");
    consoleError.mockRestore();
  });
});
