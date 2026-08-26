import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UpdateNotificationState } from "@/types";

const mocks = vi.hoisted(() => ({
  getNotice: vi.fn(),
  subscribeToSystemStatus: vi.fn(),
  unsubscribeFromSystemStatus: vi.fn(),
}));

vi.mock("@/lib/runtime/app-update-notice", () => ({
  getUpdateNotificationState: mocks.getNotice,
}));
vi.mock("@/lib/storage/system-status", () => ({
  subscribeToSystemStatus: mocks.subscribeToSystemStatus,
}));

const notice: UpdateNotificationState = {
  latestVersion: "2.5.0",
  latestReleaseTitle: "Version 2.5.0",
  latestSecurityVersion: null,
  currentVersion: "2.4.0",
  lastCheckedAt: null,
  lastCheckError: null,
  hasUpdate: true,
  isDismissed: false,
  isSecurityUpdate: false,
  shouldNotify: true,
};

describe("runtime/update-notice-bus", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    mocks.subscribeToSystemStatus.mockReturnValue(
      mocks.unsubscribeFromSystemStatus,
    );
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("stops polling when the last listener leaves during a publish", async () => {
    let resolveNotice: ((value: UpdateNotificationState) => void) | undefined;
    mocks.getNotice.mockReturnValueOnce(
      new Promise<UpdateNotificationState>((resolve) => {
        resolveNotice = resolve;
      }),
    );
    const { subscribeToUpdateNotice } = await import(
      "@/lib/runtime/update-notice-bus"
    );

    const unsubscribe = subscribeToUpdateNotice(vi.fn());
    await Promise.resolve();
    expect(mocks.getNotice).toHaveBeenCalledOnce();

    unsubscribe();
    resolveNotice?.(notice);

    await vi.waitFor(() =>
      expect(mocks.unsubscribeFromSystemStatus).toHaveBeenCalledOnce(),
    );
    await vi.advanceTimersByTimeAsync(5_000);
    expect(mocks.getNotice).toHaveBeenCalledOnce();
  });

  it("sends the current notice once to every new listener", async () => {
    mocks.getNotice.mockResolvedValue(notice);
    const { subscribeToUpdateNotice } = await import(
      "@/lib/runtime/update-notice-bus"
    );
    const firstListener = vi.fn();
    const secondListener = vi.fn();

    const unsubscribeFirst = subscribeToUpdateNotice(firstListener);
    await vi.waitFor(() => expect(firstListener).toHaveBeenCalledWith(notice));

    const unsubscribeSecond = subscribeToUpdateNotice(secondListener);
    await vi.waitFor(() => expect(secondListener).toHaveBeenCalledWith(notice));

    expect(firstListener).toHaveBeenCalledOnce();
    expect(secondListener).toHaveBeenCalledOnce();
    unsubscribeFirst();
    unsubscribeSecond();
  });

  it("does not re-add a listener that unsubscribes during delivery", async () => {
    mocks.getNotice.mockResolvedValue(notice);
    const { subscribeToUpdateNotice } = await import(
      "@/lib/runtime/update-notice-bus"
    );
    let unsubscribe = () => {};
    const listener = vi.fn(() => unsubscribe());

    unsubscribe = subscribeToUpdateNotice(listener);
    await vi.waitFor(() => expect(listener).toHaveBeenCalledOnce());
    await vi.waitFor(() =>
      expect(mocks.unsubscribeFromSystemStatus).toHaveBeenCalledOnce(),
    );

    await vi.advanceTimersByTimeAsync(5_000);
    expect(listener).toHaveBeenCalledOnce();
  });
});
