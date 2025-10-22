import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { beforeEach, afterEach, describe, it, expect } from 'vitest';

describe('settings-storage', () => {
  let tmpDir: string;
  let clearCache: (() => Promise<void>) | undefined;

  const loadModule = async () => {
    const mod = await import('@/lib/settings-storage');
    clearCache = mod.__clearSettingsCacheForTests__;
    return mod;
  };

  beforeEach(async () => {
    vi.resetModules();
    delete process.env.GITHUB_ACCESS_TOKEN;
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'grm-settings-'));
    // Mock cwd to tmpDir so storage writes under tmp
    // @ts-ignore
    vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
    await clearCache?.();
  });

  afterEach(async () => {
    // restore cwd
    // @ts-ignore
    process.cwd.mockRestore?.();
    // cleanup tmpDir
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it('creates settings file with defaults and merges correctly', async () => {
    const mod = await loadModule();
    const { getSettings } = mod;

    const settings1 = await getSettings();
    expect(settings1).toMatchObject({
      timeFormat: '24h',
      locale: 'en',
      refreshInterval: 10,
      cacheInterval: 5,
      releasesPerPage: 30,
      parallelRepoFetches: 1,
    });

    // Write partial settings and ensure merge with defaults
    const dataDir = path.join(tmpDir, 'data');
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(
      path.join(dataDir, 'settings.json'),
      JSON.stringify({ timeFormat: '12h', includeRegex: 'v.*' }, null, 2),
      'utf8',
    );

    await clearCache?.();
    const settings2 = await getSettings();
    expect(settings2.timeFormat).toBe('12h');
    expect(settings2.includeRegex).toBe('v.*');
    // default still present
    expect(settings2.releasesPerPage).toBe(30);
  });

  it('saveSettings writes file and corrupt json falls back to defaults', async () => {
    const mod = await loadModule();
    const { getSettings, saveSettings } = mod;

    await saveSettings({
      timeFormat: '24h',
      locale: 'de',
      refreshInterval: 15,
      cacheInterval: 3,
      releasesPerPage: 20,
      parallelRepoFetches: 4,
      releaseChannels: ['stable'],
    });

    const after = await getSettings();
    expect(after).toMatchObject({ locale: 'de', releasesPerPage: 20, parallelRepoFetches: 4 });

    // Corrupt the file
    const dataDir = path.join(tmpDir, 'data');
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(path.join(dataDir, 'settings.json'), '{invalid-json', 'utf8');

    await clearCache?.();
    const fallback = await getSettings();
    expect(fallback).toMatchObject({ timeFormat: '24h', locale: 'en' });
  });
});
