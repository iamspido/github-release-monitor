import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storageMocks = vi.hoisted(() => ({
  getSystemStatus: vi.fn(),
  updateSystemStatus: vi.fn(),
}));

const updateCheckMocks = vi.hoisted(() => ({
  runApplicationUpdateCheck: vi.fn(),
}));

const actionMocks = vi.hoisted(() => ({
  isRestrictedActionAllowed: vi.fn(),
}));

const schedulerMocks = vi.hoisted(() => ({
  scheduleTask: vi.fn(async (_name: string, task: () => Promise<unknown>) =>
    task(),
  ),
}));

const ORIGINAL_ENV = { ...process.env };

vi.mock("@/lib/storage/system-status", () => storageMocks);
vi.mock("@/lib/runtime/update-check", () => updateCheckMocks);
vi.mock("@/lib/server-action-helpers", () => actionMocks);
vi.mock("@/lib/runtime/task-scheduler", () => schedulerMocks);

function status(overrides = {}) {
  return {
    latestKnownVersion: null,
    lastCheckedAt: null,
    latestEtag: null,
    dismissedVersion: null,
    lastCheckError: null,
    ...overrides,
  };
}

describe("runtime/app-update-notice", () => {
  beforeEach(() => {
    vi.resetModules();
    storageMocks.getSystemStatus.mockReset();
    storageMocks.updateSystemStatus.mockReset();
    updateCheckMocks.runApplicationUpdateCheck.mockReset();
    actionMocks.isRestrictedActionAllowed.mockReset();
    schedulerMocks.scheduleTask.mockReset();
    process.env = {
      ...ORIGINAL_ENV,
      NEXT_PUBLIC_APP_VERSION: "1.2.3",
    };
    storageMocks.getSystemStatus.mockResolvedValue(status());
    storageMocks.updateSystemStatus.mockResolvedValue(undefined);
    updateCheckMocks.runApplicationUpdateCheck.mockResolvedValue(undefined);
    actionMocks.isRestrictedActionAllowed.mockResolvedValue(true);
    schedulerMocks.scheduleTask.mockImplementation(
      async (_name: string, task: () => Promise<unknown>) => task(),
    );
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("normalizes v-prefixes and build metadata before comparing versions", async () => {
    const { getUpdateNotificationState } = await import(
      "@/lib/runtime/app-update-notice"
    );

    storageMocks.getSystemStatus.mockResolvedValueOnce(
      status({ latestKnownVersion: "v1.2.3+remote" }),
    );

    await expect(getUpdateNotificationState()).resolves.toMatchObject({
      latestVersion: "v1.2.3+remote",
      currentVersion: "1.2.3",
      hasUpdate: false,
      shouldNotify: false,
    });

    storageMocks.getSystemStatus.mockResolvedValueOnce(
      status({ latestKnownVersion: "v1.2.4+remote" }),
    );

    await expect(getUpdateNotificationState()).resolves.toMatchObject({
      hasUpdate: true,
      shouldNotify: true,
    });
  });

  it("treats stable releases as newer than their prerelease of the same version", async () => {
    const { getUpdateNotificationState } = await import(
      "@/lib/runtime/app-update-notice"
    );

    process.env.NEXT_PUBLIC_APP_VERSION = "1.2.3-rc.1";
    storageMocks.getSystemStatus.mockResolvedValueOnce(
      status({ latestKnownVersion: "1.2.3" }),
    );

    await expect(getUpdateNotificationState()).resolves.toMatchObject({
      hasUpdate: true,
      shouldNotify: true,
    });

    process.env.NEXT_PUBLIC_APP_VERSION = "1.2.3";
    storageMocks.getSystemStatus.mockResolvedValueOnce(
      status({ latestKnownVersion: "1.2.3-rc.1" }),
    );

    await expect(getUpdateNotificationState()).resolves.toMatchObject({
      hasUpdate: false,
      shouldNotify: false,
    });
  });

  it("marks matching dismissed versions as dismissed and suppresses notifications", async () => {
    storageMocks.getSystemStatus.mockResolvedValue(
      status({
        latestKnownVersion: "1.2.4",
        dismissedVersion: "1.2.4",
      }),
    );
    const { getUpdateNotificationState } = await import(
      "@/lib/runtime/app-update-notice"
    );

    await expect(getUpdateNotificationState()).resolves.toMatchObject({
      hasUpdate: true,
      isDismissed: true,
      shouldNotify: false,
    });
  });

  it("does not mutate storage when dismissing without authorization", async () => {
    actionMocks.isRestrictedActionAllowed.mockResolvedValue(false);
    const { dismissUpdateNotificationAction } = await import(
      "@/lib/runtime/app-update-notice"
    );

    await expect(dismissUpdateNotificationAction()).resolves.toEqual({
      success: false,
    });
    expect(storageMocks.updateSystemStatus).not.toHaveBeenCalled();
  });

  it("stores the latest known version or null when dismissing with authorization", async () => {
    const { dismissUpdateNotificationAction } = await import(
      "@/lib/runtime/app-update-notice"
    );

    storageMocks.getSystemStatus.mockResolvedValueOnce(
      status({ latestKnownVersion: "1.2.4" }),
    );

    await expect(dismissUpdateNotificationAction()).resolves.toEqual({
      success: true,
    });
    expect(storageMocks.updateSystemStatus).toHaveBeenCalledWith(
      expect.any(Function),
    );
    expect(
      storageMocks.updateSystemStatus.mock.calls[0][0](
        status({ latestKnownVersion: "1.2.4" }),
      ),
    ).toMatchObject({ dismissedVersion: "1.2.4" });

    storageMocks.updateSystemStatus.mockClear();
    storageMocks.getSystemStatus.mockResolvedValueOnce(status());

    await expect(dismissUpdateNotificationAction()).resolves.toEqual({
      success: true,
    });
    expect(
      storageMocks.updateSystemStatus.mock.calls[0][0](status()),
    ).toMatchObject({ dismissedVersion: null });
  });

  it("returns the current notice without triggering checks when unauthorized", async () => {
    actionMocks.isRestrictedActionAllowed.mockResolvedValue(false);
    storageMocks.getSystemStatus.mockResolvedValue(
      status({ latestKnownVersion: "1.2.4" }),
    );
    const { triggerAppUpdateCheckAction } = await import(
      "@/lib/runtime/app-update-notice"
    );

    await expect(triggerAppUpdateCheckAction()).resolves.toMatchObject({
      success: false,
      notice: {
        latestVersion: "1.2.4",
        currentVersion: "1.2.3",
        hasUpdate: true,
      },
    });
    expect(storageMocks.updateSystemStatus).not.toHaveBeenCalled();
    expect(updateCheckMocks.runApplicationUpdateCheck).not.toHaveBeenCalled();
  });

  it("clears dismissed versions and runs update checks with the current app version", async () => {
    storageMocks.getSystemStatus.mockResolvedValue(
      status({ latestKnownVersion: "1.2.4", dismissedVersion: null }),
    );
    const { triggerAppUpdateCheckAction } = await import(
      "@/lib/runtime/app-update-notice"
    );

    await expect(triggerAppUpdateCheckAction()).resolves.toMatchObject({
      success: true,
      notice: {
        latestVersion: "1.2.4",
        currentVersion: "1.2.3",
        hasUpdate: true,
      },
    });
    expect(
      storageMocks.updateSystemStatus.mock.calls[0][0](
        status({ dismissedVersion: "1.2.4" }),
      ),
    ).toMatchObject({ dismissedVersion: null });
    expect(updateCheckMocks.runApplicationUpdateCheck).toHaveBeenCalledWith(
      "1.2.3",
    );
  });
});
