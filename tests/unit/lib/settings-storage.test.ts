import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const fsMock = {
  mkdir: vi.fn(),
  access: vi.fn(),
  writeFile: vi.fn(),
  readFile: vi.fn(),
  stat: vi.fn(),
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

describe('settings-storage failure scenarios', () => {
  beforeEach(() => {
    vi.resetModules();
    fsMock.mkdir.mockResolvedValue(undefined);
    fsMock.access.mockResolvedValue(undefined);
    fsMock.writeFile.mockResolvedValue(undefined);
    fsMock.readFile.mockResolvedValue('{}');
    fsMock.stat.mockResolvedValue({ mtimeMs: 1 } as any);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('throws when ensureDataFileExists cannot write settings file', async () => {
    fsMock.access.mockRejectedValueOnce(new Error('missing'));
    const failure = new Error('disk full');
    fsMock.writeFile.mockRejectedValueOnce(failure);
    const { getSettings } = await import('@/lib/settings-storage');

    await expect(getSettings()).rejects.toThrow(failure);
  });

  it('throws when saveSettings cannot persist data', async () => {
    const { saveSettings, getSettings, __clearSettingsCacheForTests__ } = await import('@/lib/settings-storage');

    // warm cache so saveSettings runs writeFile branch
    const current = await getSettings();
    await __clearSettingsCacheForTests__();

    const failure = new Error('disk full');
    fsMock.writeFile.mockRejectedValueOnce(failure);

    await expect(saveSettings(current)).rejects.toThrow('Could not save settings data.');
  });
});
