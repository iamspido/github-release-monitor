import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultLocale } from '@/i18n/routing';

vi.mock('next-intl/middleware', () => ({
  default: () => () => new Response(null, { status: 200 }),
}));

vi.mock('iron-session', () => ({
  getIronSession: vi.fn(async () => ({})),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({})),
}));

vi.mock('next/server', () => {
  class NextRequest {}
  class NextResponse extends Response {
    static next() {
      return new NextResponse(null, { status: 200 });
    }
    static redirect(input: string | URL) {
      return new NextResponse(null, {
        status: 307,
        headers: { location: input instanceof URL ? input.toString() : String(input) },
      });
    }
  }
  return { NextRequest, NextResponse };
});

vi.mock('@/lib/logger', () => {
  const mockLogger = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    withScope: () => mockLogger,
  };
  return { logger: mockLogger };
});

let fetchSettingsLocale: (request: any, options?: { fetchImpl?: typeof fetch }) => Promise<string>;

type MockRequest = {
  headers: Headers;
  nextUrl: URL;
  url: string;
};

function createRequest(url: string, headerInit?: Record<string, string>): MockRequest {
  return {
    headers: new Headers(headerInit),
    nextUrl: new URL(url),
    url,
  };
}

const createResponse = (overrides: Partial<Response> & { json?: () => Promise<any> }) =>
  ({
    ok: overrides.ok ?? true,
    status: overrides.status ?? 200,
    json: overrides.json ?? (async () => ({})),
  }) as Response;

beforeAll(async () => {
  const middlewareModule = await import('@/middleware');
  fetchSettingsLocale = middlewareModule.__test__.fetchSettingsLocale;
});

describe('fetchSettingsLocale', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('falls back to localhost when public origin fails', async () => {
    const request = createRequest('https://public.example.com/en/dashboard', {
      host: 'public.example.com',
      'x-forwarded-proto': 'https',
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.startsWith('http://127.0.0.1:3000')) {
        return createResponse({
          ok: true,
          status: 200,
          json: async () => ({ locale: 'de' }),
        });
      }
      return createResponse({ ok: false, status: 500 });
    });

    const locale = await fetchSettingsLocale(request as any, { fetchImpl: fetchMock });

    expect(locale).toBe('de');
    expect(fetchMock).toHaveBeenCalled();
    const attempted = fetchMock.mock.calls.map(call => {
      const target = call[0];
      if (typeof target === 'string') return target;
      if (target instanceof URL) return target.toString();
      return (target as Request).url;
    });
    expect(attempted.some(u => u.startsWith('https://public.example.com'))).toBe(true);
    expect(attempted.some(u => u.startsWith('http://127.0.0.1:3000'))).toBe(true);
  });

  it('returns default locale when all attempts fail', async () => {
    const request = createRequest('https://public.example.com/en', {
      host: 'public.example.com',
    });

    const fetchMock = vi.fn(async () => createResponse({ ok: false, status: 500 }));

    const locale = await fetchSettingsLocale(request as any, { fetchImpl: fetchMock });

    expect(locale).toBe(defaultLocale);
    expect(fetchMock).toHaveBeenCalled();
  });
});
