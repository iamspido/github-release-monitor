import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

describe('settings-storage', () => {
  let tmpDir: string;

  beforeEach(async () => {
    vi.resetModules();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'grm-settings-'));
    // Mock cwd to tmpDir so storage writes under tmp
    // @ts-ignore
    vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
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
    const mod = await import('@/lib/settings-storage');
    const { getSettings } = mod;

    const settings1 = await getSettings();
    expect(settings1).toMatchObject({
      timeFormat: '24h',
      locale: 'en',
      refreshInterval: 10,
      cacheInterval: 5,
      releasesPerPage: 30,
    });

    // Write partial settings and ensure merge with defaults
    const dataDir = path.join(tmpDir, 'data');
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(
      path.join(dataDir, 'settings.json'),
      JSON.stringify({ timeFormat: '12h', includeRegex: 'v.*' }, null, 2),
      'utf8',
    );

    const settings2 = await getSettings();
    expect(settings2.timeFormat).toBe('12h');
    expect(settings2.includeRegex).toBe('v.*');
    // default still present
    expect(settings2.releasesPerPage).toBe(30);
  });

  it('saveSettings writes file and corrupt json falls back to defaults', async () => {
    const mod = await import('@/lib/settings-storage');
    const { getSettings, saveSettings } = mod;

    await saveSettings({
      timeFormat: '24h',
      locale: 'de',
      refreshInterval: 15,
      cacheInterval: 3,
      releasesPerPage: 20,
      releaseChannels: ['stable'],
    });

    const after = await getSettings();
    expect(after).toMatchObject({ locale: 'de', releasesPerPage: 20 });

    // Corrupt the file
    const dataDir = path.join(tmpDir, 'data');
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(path.join(dataDir, 'settings.json'), '{invalid-json', 'utf8');

    const fallback = await getSettings();
    expect(fallback).toMatchObject({ timeFormat: '24h', locale: 'en' });
  });
});

