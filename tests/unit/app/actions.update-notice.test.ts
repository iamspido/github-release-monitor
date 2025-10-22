import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const getSystemStatusMock = vi.fn();
const updateSystemStatusMock = vi.fn();
const runApplicationUpdateCheckMock = vi.fn();
const scheduleTaskMock = vi.fn(async (_name: string, task: () => Promise<any>) => task());

vi.mock('@/lib/system-status', () => ({
  getSystemStatus: getSystemStatusMock,
  updateSystemStatus: updateSystemStatusMock,
}));

vi.mock('@/lib/update-check', () => ({
  runApplicationUpdateCheck: runApplicationUpdateCheckMock,
}));

vi.mock('@/lib/task-scheduler', () => ({
  scheduleTask: scheduleTaskMock,
}));

const defaultStatus = {
  latestKnownVersion: null,
  lastCheckedAt: null,
  latestEtag: null,
  dismissedVersion: null,
  lastCheckError: null,
};

const envBackup = { ...process.env };

describe('update notification actions', () => {
  beforeEach(() => {
    vi.resetModules();
    getSystemStatusMock.mockReset();
    updateSystemStatusMock.mockReset();
    runApplicationUpdateCheckMock.mockReset();
    scheduleTaskMock.mockImplementation(async (_name: string, task: () => Promise<any>) => task());
    process.env = { ...envBackup, NODE_ENV: 'test', NEXT_PUBLIC_APP_VERSION: '1.2.0' };
    getSystemStatusMock.mockResolvedValue(defaultStatus);
    updateSystemStatusMock.mockResolvedValue(defaultStatus);
  });

  afterEach(() => {
    process.env = { ...envBackup };
  });

  it('marks update available when remote version is higher', async () => {
    getSystemStatusMock.mockResolvedValue({
      ...defaultStatus,
      latestKnownVersion: 'v1.4.0',
    });

    process.env.NEXT_PUBLIC_APP_VERSION = '1.3.0';

    const { getUpdateNotificationState } = await import('@/app/actions');

    const state = await getUpdateNotificationState();

    expect(state.hasUpdate).toBe(true);
    expect(state.shouldNotify).toBe(true);
    expect(state.latestVersion).toBe('v1.4.0');
  });

  it('does not mark update when remote version is older', async () => {
    getSystemStatusMock.mockResolvedValue({
      ...defaultStatus,
      latestKnownVersion: '1.1.5',
    });
    process.env.NEXT_PUBLIC_APP_VERSION = '1.2.0';

    const { getUpdateNotificationState } = await import('@/app/actions');
    const state = await getUpdateNotificationState();

    expect(state.hasUpdate).toBe(false);
    expect(state.shouldNotify).toBe(false);
  });

  it('handles identical versions with different prefixes', async () => {
    getSystemStatusMock.mockResolvedValue({
      ...defaultStatus,
      latestKnownVersion: 'v1.2.0',
    });
    process.env.NEXT_PUBLIC_APP_VERSION = '1.2.0';

    const { getUpdateNotificationState } = await import('@/app/actions');
    const state = await getUpdateNotificationState();

    expect(state.hasUpdate).toBe(false);
    expect(state.shouldNotify).toBe(false);
  });

  it('resets dismissed flag and runs manual check', async () => {
    getSystemStatusMock.mockResolvedValue({
      ...defaultStatus,
      latestKnownVersion: '1.2.0',
      dismissedVersion: '1.2.0',
    });

    updateSystemStatusMock.mockImplementation(async (updater: any) => {
      const updated = await updater({
        ...defaultStatus,
        latestKnownVersion: '1.2.0',
        dismissedVersion: '1.2.0',
      });
      expect(updated.dismissedVersion).toBeNull();
      return updated;
    });

    getSystemStatusMock.mockResolvedValueOnce({
      ...defaultStatus,
      latestKnownVersion: '1.2.0',
      dismissedVersion: '1.2.0',
    });

    runApplicationUpdateCheckMock.mockImplementation(async () => {
      getSystemStatusMock.mockResolvedValueOnce({
        ...defaultStatus,
        latestKnownVersion: '1.2.0',
        lastCheckedAt: '2024-01-01T00:00:00.000Z',
      });

      return {
        latestKnownVersion: '1.2.0',
        lastCheckedAt: '2024-01-01T00:00:00.000Z',
        latestEtag: null,
        dismissedVersion: null,
        lastCheckError: null,
      };
    });

    const { triggerAppUpdateCheckAction } = await import('@/app/actions');

    const result = await triggerAppUpdateCheckAction();

    expect(scheduleTaskMock).toHaveBeenCalledWith(
      'triggerAppUpdateCheck',
      expect.any(Function)
    );
    expect(runApplicationUpdateCheckMock).toHaveBeenCalledWith('1.2.0');
    expect(result.notice.currentVersion).toBe('1.2.0');
    expect(result.notice.latestVersion).toBe('1.2.0');
    expect(result.notice.shouldNotify).toBe(false);
    expect(result.notice.isDismissed).toBe(false);
  });
});
