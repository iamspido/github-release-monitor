import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const scopedLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
  withScope: vi.fn(() => scopedLogger),
};

vi.mock('@/lib/logger', () => ({
  logger: scopedLogger,
}));

vi.mock('@/lib/system-status', () => ({
  getSystemStatus: vi.fn(),
  saveSystemStatus: vi.fn(),
}));

describe('runApplicationUpdateCheck', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
    scopedLogger.info.mockClear();
    scopedLogger.warn.mockClear();
    scopedLogger.error.mockClear();
    scopedLogger.debug.mockClear();
    scopedLogger.withScope.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('updates lastCheckedAt when release information is unchanged (304)', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 304 }));
    vi.stubGlobal('fetch', fetchMock);

    const { getSystemStatus, saveSystemStatus } = await import('@/lib/system-status');
    const getSystemStatusMock = vi.mocked(getSystemStatus);
    const saveSystemStatusMock = vi.mocked(saveSystemStatus);

    const previousStatus = {
      latestKnownVersion: '1.0.0',
      lastCheckedAt: 'before',
      latestEtag: '"etag-123"',
      dismissedVersion: '1.0.0',
      lastCheckError: 'old_error',
    };
    getSystemStatusMock.mockResolvedValue(previousStatus);
    saveSystemStatusMock.mockResolvedValue();

    const { runApplicationUpdateCheck } = await import('@/lib/update-check');
    const result = await runApplicationUpdateCheck('1.0.0');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/iamspido/github-release-monitor/releases/latest',
      expect.objectContaining({
        cache: 'no-store',
        headers: expect.objectContaining({
          'If-None-Match': '"etag-123"',
        }),
      }),
    );

    expect(saveSystemStatusMock).toHaveBeenCalledWith({
      ...previousStatus,
      lastCheckedAt: new Date('2024-01-01T00:00:00.000Z').toISOString(),
      lastCheckError: null,
    });
    expect(result.lastCheckError).toBeNull();
    expect(scopedLogger.debug).toHaveBeenCalledWith('Update check: release information unchanged (304).');
  });

  it('stores new release information and clears dismissed version when version changes', async () => {
    const responseHeaders = new Headers({ etag: '"etag-new"' });
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ tag_name: 'v2.0.0' }),
      { status: 200, headers: responseHeaders },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const { getSystemStatus, saveSystemStatus } = await import('@/lib/system-status');
    const getSystemStatusMock = vi.mocked(getSystemStatus);
    const saveSystemStatusMock = vi.mocked(saveSystemStatus);

    const previousStatus = {
      latestKnownVersion: 'v1.0.0',
      lastCheckedAt: 'before',
      latestEtag: '"etag-123"',
      dismissedVersion: 'v1.0.0',
      lastCheckError: null,
    };
    getSystemStatusMock.mockResolvedValue(previousStatus);
    saveSystemStatusMock.mockResolvedValue();

    const { runApplicationUpdateCheck } = await import('@/lib/update-check');
    const result = await runApplicationUpdateCheck('1.5.0');

    expect(saveSystemStatusMock).toHaveBeenCalledWith({
      latestKnownVersion: 'v2.0.0',
      lastCheckedAt: new Date('2024-01-01T00:00:00.000Z').toISOString(),
      latestEtag: '"etag-new"',
      dismissedVersion: null,
      lastCheckError: null,
    });

    expect(result.latestKnownVersion).toBe('v2.0.0');
    expect(scopedLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('Update available: current=1.5.0 latest=v2.0.0'),
    );
  });

  it('captures HTTP errors and stores the status message', async () => {
    const fetchMock = vi.fn(async () => new Response(null, {
      status: 503,
      statusText: 'Service Unavailable',
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { getSystemStatus, saveSystemStatus } = await import('@/lib/system-status');
    const getSystemStatusMock = vi.mocked(getSystemStatus);
    const saveSystemStatusMock = vi.mocked(saveSystemStatus);

    const previousStatus = {
      latestKnownVersion: null,
      lastCheckedAt: null,
      latestEtag: null,
      dismissedVersion: null,
      lastCheckError: null,
    };
    getSystemStatusMock.mockResolvedValue(previousStatus);
    saveSystemStatusMock.mockResolvedValue();

    const { runApplicationUpdateCheck } = await import('@/lib/update-check');
    const result = await runApplicationUpdateCheck('1.0.0');

    expect(saveSystemStatusMock).toHaveBeenCalledWith({
      ...previousStatus,
      lastCheckedAt: new Date('2024-01-01T00:00:00.000Z').toISOString(),
      lastCheckError: '503 Service Unavailable',
    });
    expect(result.lastCheckError).toBe('503 Service Unavailable');
    expect(scopedLogger.warn).toHaveBeenCalledWith(
      'Update check failed with HTTP error: 503 Service Unavailable',
    );
  });

  it('captures thrown errors and stores an error message', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('boom');
    });
    vi.stubGlobal('fetch', fetchMock);

    const { getSystemStatus, saveSystemStatus } = await import('@/lib/system-status');
    const getSystemStatusMock = vi.mocked(getSystemStatus);
    const saveSystemStatusMock = vi.mocked(saveSystemStatus);

    const previousStatus = {
      latestKnownVersion: 'v1.0.0',
      lastCheckedAt: 'before',
      latestEtag: '"etag-old"',
      dismissedVersion: null,
      lastCheckError: null,
    };
    getSystemStatusMock.mockResolvedValue(previousStatus);
    saveSystemStatusMock.mockResolvedValue();

    const { runApplicationUpdateCheck } = await import('@/lib/update-check');
    const result = await runApplicationUpdateCheck('1.0.0');

    expect(saveSystemStatusMock).toHaveBeenCalledWith({
      ...previousStatus,
      lastCheckedAt: new Date('2024-01-01T00:00:00.000Z').toISOString(),
      lastCheckError: 'boom',
    });
    expect(result.lastCheckError).toBe('boom');
    expect(scopedLogger.error).toHaveBeenCalledWith(
      'Update check failed with exception:',
      expect.any(Error),
    );
  });
});
