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

vi.mock("next-intl", () => ({
  useTranslations:
    () => (key: string, values?: Record<string, string | null>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
}));

vi.mock("@/app/actions", () => ({
  dismissUpdateNotificationAction: () => mocks.dismiss(),
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
    currentVersion: "2.3.0",
    lastCheckedAt: "2026-07-27T12:00:00.000Z",
    lastCheckError: null,
    hasUpdate: true,
    isDismissed: false,
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

describe("UpdateNoticeBanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dismiss.mockResolvedValue({ success: true });
    mocks.pendingAction = Promise.resolve();
  });

  afterEach(() => {
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
  });

  it("hides itself after a successful dismissal", async () => {
    const container = await renderBanner({ notice: createNotice() });
    const dismissButton = container.querySelector("button");
    expect(dismissButton?.textContent).toContain("dismiss_label");

    await act(async () => {
      dismissButton?.click();
      await mocks.pendingAction;
    });

    expect(mocks.dismiss).toHaveBeenCalledOnce();
    expect(container.textContent).toBe("");
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
