import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultLocale } from '@/i18n/routing';
import { getIronSession } from 'iron-session';
import { SETTINGS_LOCALE_COOKIE, NEXT_LOCALE_COOKIE } from '@/lib/settings-locale-cookie';
import type { SessionData } from '@/types';

const handleI18nMock = vi.fn();
const createIntlMiddlewareMock = vi.fn(() => handleI18nMock);

vi.mock('next-intl/middleware', () => ({
  __esModule: true,
  default: createIntlMiddlewareMock,
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
    cookies: {
      set: (name: string, value: string, options?: Record<string, unknown>) => void;
      get: (name: string) => { name: string; value: string; options?: Record<string, unknown> } | undefined;
      getAll: () => Array<{ name: string; value: string; options?: Record<string, unknown> }>;
    };

    #cookieStore: Map<string, { name: string; value: string; options?: Record<string, unknown> }>;

    constructor(body?: BodyInit | null, init?: ResponseInit) {
      super(body, init);
      this.#cookieStore = new Map();
      this.cookies = {
        set: (name, value, options) => {
          this.#cookieStore.set(name, { name, value, options });
          this.headers.append('set-cookie', `${name}=${value}`);
        },
        get: name => this.#cookieStore.get(name),
        getAll: () => Array.from(this.#cookieStore.values()),
      };
    }

    static next() {
      return new NextResponse(null, { status: 200 });
    }
    static redirect(input: string | URL) {
      const location = input instanceof URL ? input.toString() : String(input);
      const response = new NextResponse(null, {
        status: 307,
        headers: { location },
      });
      return response;
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
let buildSettingsLocaleApiUrls: (request: any) => URL[];
let middlewareFn: ((request: any) => Promise<Response>) | undefined;

type MockRequest = {
  headers: Headers;
  nextUrl: URL;
  url: string;
  cookies: {
    get: (name: string) => { value: string } | undefined;
  };
};

function createRequest(
  url: string,
  headerInit?: Record<string, string>,
  cookieValues?: Record<string, string>,
): MockRequest {
  const cookieStore = new Map<string, string>();
  if (cookieValues) {
    for (const [key, value] of Object.entries(cookieValues)) {
      cookieStore.set(key, value);
    }
  }

  return {
    headers: new Headers(headerInit),
    nextUrl: new URL(url),
    url,
    cookies: {
      get: (name: string) => {
        const value = cookieStore.get(name);
        return value ? { value } : undefined;
      },
    },
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
  buildSettingsLocaleApiUrls = middlewareModule.__test__.buildSettingsLocaleApiUrls;
  middlewareFn = middlewareModule.middleware;
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

describe('buildSettingsLocaleApiUrls', () => {
  it('normalizes zero address host to loopback http origin', () => {
    const request = createRequest('https://0.0.0.0:3000/en', {
      host: '0.0.0.0:3000',
      'x-forwarded-proto': 'https',
    });

    const urls = buildSettingsLocaleApiUrls(request as any);
    const origins = urls.map(url => url.origin);

    expect(origins).toContain('http://127.0.0.1:3000');
    expect(origins).not.toContain('https://0.0.0.0:3000');
  });
});

describe('middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    handleI18nMock.mockReset();
    createIntlMiddlewareMock.mockReset();
    createIntlMiddlewareMock.mockReturnValue(handleI18nMock);
  });

  it('redirects unauthenticated users to locale login and sets cookies', async () => {
    expect(middlewareFn).toBeDefined();
    const { NextResponse } = await import('next/server');

    const baseResponse = new NextResponse(null, { status: 200 });
    baseResponse.headers.set('x-next-intl-locale', 'de');
    handleI18nMock.mockReturnValue(baseResponse);

    const getIronSessionMock = vi.mocked(getIronSession);
    getIronSessionMock.mockResolvedValue({ isLoggedIn: false } as SessionData);

    const request = createRequest(
      'https://example.com/de/einstellungen',
      { host: 'example.com' },
      { [SETTINGS_LOCALE_COOKIE]: 'de' },
    );

    const response = await middlewareFn!(request as any);

    expect(createIntlMiddlewareMock).toHaveBeenCalledTimes(1);
    expect(handleI18nMock).toHaveBeenCalledTimes(1);

    expect(response.status).toBe(307);
    const redirectUrl = response.headers.get('location');
    expect(redirectUrl).toBeTruthy();
    const parsed = redirectUrl ? new URL(redirectUrl) : null;
    expect(parsed?.pathname).toBe('/de/anmelden');
    expect(parsed?.searchParams.get('next')).toBe('/de/einstellungen');
    expect(response.cookies.get(SETTINGS_LOCALE_COOKIE)?.value).toBe('de');
    expect(response.cookies.get(NEXT_LOCALE_COOKIE)?.value).toBe('de');
  });

  it('redirects logged-in users away from the login page', async () => {
    expect(middlewareFn).toBeDefined();
    const { NextResponse } = await import('next/server');

    const baseResponse = new NextResponse(null, { status: 200 });
    baseResponse.headers.set('x-next-intl-locale', 'de');
    handleI18nMock.mockReturnValue(baseResponse);

    const getIronSessionMock = vi.mocked(getIronSession);
    getIronSessionMock.mockResolvedValue({ isLoggedIn: true } as SessionData);

    const request = createRequest(
      'https://example.com/de/anmelden',
      { host: 'example.com' },
      { [SETTINGS_LOCALE_COOKIE]: 'de' },
    );

    const response = await middlewareFn!(request as any);

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://example.com/de');
    expect(response.cookies.get(SETTINGS_LOCALE_COOKIE)?.value).toBe('de');
    expect(response.cookies.get(NEXT_LOCALE_COOKIE)?.value).toBe('de');
  });

  it('blocks disallowed origins during development', async () => {
    expect(middlewareFn).toBeDefined();
    const { NextResponse } = await import('next/server');

    const baseResponse = new NextResponse(null, { status: 200 });
    baseResponse.headers.set('x-next-intl-locale', 'de');
    handleI18nMock.mockReturnValue(baseResponse);

    const originalNodeEnv = process.env.NODE_ENV;
    const originalAllowed = process.env.ALLOWED_DEV_ORIGINS;
    process.env.NODE_ENV = 'development';
    process.env.ALLOWED_DEV_ORIGINS = 'https://allowed.example.com';

    try {
      const getIronSessionMock = vi.mocked(getIronSession);
      getIronSessionMock.mockResolvedValue({ isLoggedIn: true } as SessionData);

      const request = createRequest(
        'https://example.com/de',
        {
          host: 'example.com',
          origin: 'https://blocked.example.com',
        },
        { [SETTINGS_LOCALE_COOKIE]: 'de' },
      );

      const response = await middlewareFn!(request as any);

      expect(response.status).toBe(403);
      expect(await response.text()).toBe('Forbidden');
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
      process.env.ALLOWED_DEV_ORIGINS = originalAllowed;
    }
  });

  it('applies security headers on successful responses', async () => {
    expect(middlewareFn).toBeDefined();
    const { NextResponse } = await import('next/server');

    const baseResponse = new NextResponse(null, { status: 200 });
    baseResponse.headers.set('x-next-intl-locale', 'de');
    handleI18nMock.mockReturnValue(baseResponse);

    const getIronSessionMock = vi.mocked(getIronSession);
    getIronSessionMock.mockResolvedValue({ isLoggedIn: true } as SessionData);

    const originalNodeEnv = process.env.NODE_ENV;
    const originalHttps = process.env.HTTPS;
    process.env.NODE_ENV = 'production';
    process.env.HTTPS = 'true';

    try {
      const request = createRequest(
        'https://example.com/de',
        { host: 'example.com' },
        { [SETTINGS_LOCALE_COOKIE]: 'de' },
      );

      const response = await middlewareFn!(request as any);

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Security-Policy')).toContain("default-src 'self'");
      expect(response.headers.get('Content-Security-Policy')).toContain('upgrade-insecure-requests');
      expect(response.headers.get('X-Frame-Options')).toBe('DENY');
      expect(response.cookies.get(NEXT_LOCALE_COOKIE)?.value).toBe('de');
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
      process.env.HTTPS = originalHttps;
    }
  });
});
