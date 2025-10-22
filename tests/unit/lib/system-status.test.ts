import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fsMock = {
  mkdir: vi.fn(),
  access: vi.fn(),
  writeFile: vi.fn(),
  readFile: vi.fn(),
};

vi.mock('fs', () => ({
  promises: fsMock,
}));

vi.mock('@/lib/logger', () => {
  const logger = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    withScope: () => logger,
  };
  return { logger };
});

describe('system-status persistence', () => {
  beforeEach(() => {
    fsMock.mkdir.mockResolvedValue(undefined);
    fsMock.access.mockResolvedValue(undefined);
    fsMock.writeFile.mockResolvedValue(undefined);
    fsMock.readFile.mockResolvedValue('{}');
  });

  afterEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
  });

  it('returns read_error when reading system status fails', async () => {
    fsMock.readFile.mockRejectedValueOnce(new Error('boom'));
    const { getSystemStatus } = await import('@/lib/system-status');

    const status = await getSystemStatus();

    expect(status.lastCheckError).toBe('read_error');
  });

  it('throws a descriptive error when saving fails', async () => {
    fsMock.writeFile.mockRejectedValueOnce(new Error('disk full'));
    const { saveSystemStatus } = await import('@/lib/system-status');

    await expect(
      saveSystemStatus({
        latestKnownVersion: null,
        lastCheckedAt: null,
        latestEtag: null,
        dismissedVersion: null,
        lastCheckError: null,
      }),
    ).rejects.toThrow('Could not persist system status.');
  });

  it('fails when creating the data directory is impossible', async () => {
    fsMock.mkdir.mockRejectedValueOnce(new Error('no perms'));
    const { getSystemStatus } = await import('@/lib/system-status');

    await expect(getSystemStatus()).rejects.toThrow(
      'Unable to initialize system status storage directory.',
    );
  });

  it('fails when writing initial system status file is impossible', async () => {
    fsMock.access.mockRejectedValueOnce(new Error('missing'));
    fsMock.writeFile.mockRejectedValueOnce(new Error('disk full'));
    const { getSystemStatus } = await import('@/lib/system-status');

    await expect(getSystemStatus()).rejects.toThrow(
      'Unable to initialize system status data file.',
    );
  });
});
