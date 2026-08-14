import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { defaultLocale } from "@/i18n/routing";
import {
  NEXT_LOCALE_COOKIE,
  SETTINGS_LOCALE_COOKIE,
} from "@/lib/settings-locale-cookie";

const {
  createIntlMiddlewareMock,
  ensureAuthDatabaseReadyMock,
  getSessionMock,
  handleI18nMock,
} = vi.hoisted(() => {
  const handleI18n = vi.fn();
  type AuthSession = {
    session: { id: string };
    user: { id: string };
  } | null;
  return {
    createIntlMiddlewareMock: vi.fn(() => handleI18n),
    ensureAuthDatabaseReadyMock: vi.fn(async () => undefined),
    getSessionMock: vi.fn<() => Promise<AuthSession>>(async () => null),
    handleI18nMock: handleI18n,
  };
});

vi.mock("next-intl/middleware", () => ({
  __esModule: true,
  default: createIntlMiddlewareMock,
}));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: getSessionMock,
    },
  },
  ensureAuthDatabaseReady: ensureAuthDatabaseReadyMock,
}));

vi.mock("next/server", () => {
  class NextRequest {}
  class NextResponse extends Response {
    cookies: {
      set: (
        name: string,
        value: string,
        options?: Record<string, unknown>,
      ) => void;
      get: (
        name: string,
      ) =>
        | { name: string; value: string; options?: Record<string, unknown> }
        | undefined;
      getAll: () => Array<{
        name: string;
        value: string;
        options?: Record<string, unknown>;
      }>;
    };

    #cookieStore: Map<
      string,
      { name: string; value: string; options?: Record<string, unknown> }
    >;

    constructor(body?: BodyInit | null, init?: ResponseInit) {
      super(body, init);
      this.#cookieStore = new Map();
      this.cookies = {
        set: (name, value, options) => {
          this.#cookieStore.set(name, { name, value, options });
          this.headers.append("set-cookie", `${name}=${value}`);
        },
        get: (name) => this.#cookieStore.get(name),
        getAll: () => Array.from(this.#cookieStore.values()),
      };
    }

    static next(init?: { request?: { headers?: Headers } }) {
      const response = new NextResponse(null, { status: 200 });
      if (init?.request?.headers) {
        const names: string[] = [];
        for (const [name, value] of init.request.headers) {
          names.push(name);
          response.headers.set(`x-middleware-request-${name}`, value);
        }
        response.headers.set("x-middleware-override-headers", names.join(","));
      }
      return response;
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

vi.mock("@/lib/logger", () => {
  const mockLogger = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    withScope: () => mockLogger,
  };
  return { logger: mockLogger };
});

type MockRequest = {
  headers: Headers;
  nextUrl: URL;
  url: string;
  cookies: {
    get: (name: string) => { value: string } | undefined;
  };
};

type TestResponse = Response & {
  cookies: {
    get: (name: string) => { value: string } | undefined;
  };
};

type JsonPayload = Record<string, unknown>;

let fetchSettingsLocale: (
  request: MockRequest,
  options?: { fetchImpl?: typeof fetch; timeoutMs?: number },
) => Promise<string | null>;
let buildSettingsLocaleApiUrls: (request: MockRequest) => URL[];
let getLocaleFromCookies: (request: MockRequest) => string | null;
let proxyFn: ((request: MockRequest) => Promise<TestResponse>) | undefined;
let proxyMatcher = "";
let persistedSettingsLocale = defaultLocale;

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
    const configuredLocale = cookieValues[SETTINGS_LOCALE_COOKIE];
    if (configuredLocale === "en" || configuredLocale === "de") {
      persistedSettingsLocale = configuredLocale;
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

const createResponse = (
  overrides: Partial<Response> & { json?: () => Promise<JsonPayload> },
) =>
  ({
    ok: overrides.ok ?? true,
    status: overrides.status ?? 200,
    json: overrides.json ?? (async () => ({})),
  }) as Response;

beforeAll(async () => {
  const proxyModule = await import("@/proxy");
  const settingsLocaleModule = await import("@/lib/proxy/settings-locale");
  fetchSettingsLocale = proxyModule.__test__
    .fetchSettingsLocale as unknown as typeof fetchSettingsLocale;
  buildSettingsLocaleApiUrls = proxyModule.__test__
    .buildSettingsLocaleApiUrls as unknown as typeof buildSettingsLocaleApiUrls;
  getLocaleFromCookies =
    settingsLocaleModule.getLocaleFromCookies as unknown as typeof getLocaleFromCookies;
  proxyFn = proxyModule.proxy as unknown as typeof proxyFn;
  proxyMatcher = proxyModule.config.matcher[0];
});

afterAll(() => {
  vi.unstubAllGlobals();
});

function getProxy() {
  if (!proxyFn) {
    throw new Error("proxy not loaded");
  }
  return proxyFn;
}

describe("fetchSettingsLocale", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.SETTINGS_LOCALE_ALLOWED_ORIGINS;
  });

  it("tries configured allowed origins before localhost fallback", async () => {
    process.env.SETTINGS_LOCALE_ALLOWED_ORIGINS = "https://public.example.test";
    const request = createRequest("https://public.example.test/en/dashboard", {
      host: "public.example.test",
      "x-forwarded-proto": "https",
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (url.startsWith("http://127.0.0.1:3000")) {
        return createResponse({
          ok: true,
          status: 200,
          json: async () => ({ locale: "de" }),
        });
      }
      return createResponse({ ok: false, status: 500 });
    });

    const locale = await fetchSettingsLocale(request, {
      fetchImpl: fetchMock,
    });

    expect(locale).toBe("de");
    expect(fetchMock).toHaveBeenCalled();
    const attempted = fetchMock.mock.calls.map((call) => {
      const target = call[0];
      if (typeof target === "string") return target;
      if (target instanceof URL) return target.toString();
      return (target as Request).url;
    });
    expect(
      attempted.some((u) => u.startsWith("https://public.example.test")),
    ).toBe(true);
    expect(attempted.some((u) => u.startsWith("http://127.0.0.1:3000"))).toBe(
      true,
    );
  });

  it("returns no persisted locale when all attempts fail", async () => {
    const request = createRequest("https://public.example.test/en", {
      host: "public.example.test",
    });

    const fetchMock = vi.fn(async () =>
      createResponse({ ok: false, status: 500 }),
    );

    const locale = await fetchSettingsLocale(request, {
      fetchImpl: fetchMock,
    });

    expect(locale).toBeNull();
    expect(fetchMock).toHaveBeenCalled();
  });

  it("applies one timeout budget across all candidate origins", async () => {
    const request = createRequest("https://public.example.test/en", {
      host: "public.example.test",
    });
    const nowSpy = vi
      .spyOn(Date, "now")
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(1000)
      .mockReturnValue(1025);
    const fetchMock = vi.fn(async () =>
      createResponse({ ok: false, status: 500 }),
    );

    try {
      const locale = await fetchSettingsLocale(request, {
        fetchImpl: fetchMock,
        timeoutMs: 25,
      });

      expect(locale).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      nowSpy.mockRestore();
    }
  });
});

describe("getLocaleFromCookies", () => {
  it("uses a valid fallback cookie when the preferred cookie is invalid", () => {
    const request = createRequest("https://example.test/", undefined, {
      [SETTINGS_LOCALE_COOKIE]: "unsupported",
      [NEXT_LOCALE_COOKIE]: "de",
    });

    expect(getLocaleFromCookies(request)).toBe("de");
  });

  it("keeps a valid settings cookie authoritative", () => {
    const request = createRequest("https://example.test/", undefined, {
      [SETTINGS_LOCALE_COOKIE]: "en",
      [NEXT_LOCALE_COOKIE]: "de",
    });

    expect(getLocaleFromCookies(request)).toBe("en");
  });
});

describe("buildSettingsLocaleApiUrls", () => {
  beforeEach(() => {
    delete process.env.SETTINGS_LOCALE_ALLOWED_ORIGINS;
  });

  it("returns loopback-only origins by default", () => {
    const request = createRequest("https://0.0.0.0:3000/en", {
      host: "0.0.0.0:3000",
      "x-forwarded-proto": "https",
    });

    const urls = buildSettingsLocaleApiUrls(request);
    const origins = urls.map((url) => url.origin);

    expect(origins).toContain("http://127.0.0.1:3000");
    expect(origins).toContain("http://localhost:3000");
    expect(origins.some((origin) => origin.includes("example.test"))).toBe(
      false,
    );
  });

  it("includes explicit non-loopback origins only from env allowlist", () => {
    process.env.SETTINGS_LOCALE_ALLOWED_ORIGINS =
      "https://public.example.test,https://alt.example.test";
    const request = createRequest("https://public.example.test/en", {
      host: "attacker.example.test",
      "x-forwarded-host": "attacker.example.test",
    });

    const urls = buildSettingsLocaleApiUrls(request);
    const origins = urls.map((url) => url.origin);

    expect(origins).toContain("https://public.example.test");
    expect(origins).toContain("https://alt.example.test");
    expect(origins).not.toContain("https://attacker.example.test");
  });
});

describe("proxy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    persistedSettingsLocale = defaultLocale;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        createResponse({
          ok: true,
          status: 200,
          json: async () => ({ locale: persistedSettingsLocale }),
        }),
      ),
    );
    delete process.env.AUTHENTICATION_METHOD;
    handleI18nMock.mockReset();
    createIntlMiddlewareMock.mockReset();
    createIntlMiddlewareMock.mockImplementation(() => handleI18nMock);
    getSessionMock.mockReset();
    getSessionMock.mockResolvedValue(null);
    ensureAuthDatabaseReadyMock.mockReset();
    ensureAuthDatabaseReadyMock.mockResolvedValue(undefined);
  });

  it("uses persisted settings instead of a stale locale cookie", async () => {
    const request = createRequest(
      "https://example.test/en",
      { host: "example.test" },
      { [SETTINGS_LOCALE_COOKIE]: "en" },
    );
    persistedSettingsLocale = "de";

    const response = await getProxy()(request);

    expect(globalThis.fetch).toHaveBeenCalled();
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://example.test/de");
    expect(response.cookies.get(SETTINGS_LOCALE_COOKIE)?.value).toBe("de");
    expect(response.cookies.get(NEXT_LOCALE_COOKIE)?.value).toBe("de");
  });

  it("uses the locale cookie only while persisted settings are unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse({ ok: false, status: 500 })),
    );
    const request = createRequest(
      "https://example.test/de/unknown",
      { host: "example.test" },
      { [SETTINGS_LOCALE_COOKIE]: "de" },
    );

    const response = await getProxy()(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://example.test/de");
  });

  it("matches lookalike prefixes but excludes reserved route segments", () => {
    const matcher = new RegExp(`^${proxyMatcher}$`);

    for (const pathname of [
      "/apiary",
      "/trpc-tools",
      "/_nextish",
      "/_vercel-app",
    ]) {
      expect(matcher.test(pathname), pathname).toBe(true);
    }
    for (const pathname of [
      "/api",
      "/api/auth",
      "/trpc/query",
      "/_next/static/app.js",
      "/_vercel/insights",
    ]) {
      expect(matcher.test(pathname), pathname).toBe(false);
    }
  });

  it("redirects unknown paths that only resemble reserved prefixes", async () => {
    const request = createRequest("https://example.test/apiary", {
      host: "example.test",
    });

    const response = await getProxy()(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://example.test/en");
  });

  it("redirects unauthenticated users to locale login and sets cookies", async () => {
    expect(proxyFn).toBeDefined();
    const { NextResponse } = await import("next/server");

    const baseResponse = new NextResponse(null, { status: 200 });
    baseResponse.headers.set("x-next-intl-locale", "de");
    handleI18nMock.mockReturnValue(baseResponse);

    getSessionMock.mockResolvedValue(null);

    const request = createRequest(
      "https://example.test/de/einstellungen",
      { host: "example.test" },
      { [SETTINGS_LOCALE_COOKIE]: "de" },
    );

    const response = await getProxy()(request);

    expect(createIntlMiddlewareMock).toHaveBeenCalledTimes(1);
    expect(handleI18nMock).toHaveBeenCalledTimes(1);

    expect(response.status).toBe(307);
    const redirectUrl = response.headers.get("location");
    expect(redirectUrl).toBeTruthy();
    const parsed = redirectUrl ? new URL(redirectUrl) : null;
    expect(parsed?.pathname).toBe("/de/anmelden");
    expect(parsed?.searchParams.get("next")).toBe("/de/einstellungen");
    expect(response.cookies.get(SETTINGS_LOCALE_COOKIE)?.value).toBe("de");
    expect(response.cookies.get(NEXT_LOCALE_COOKIE)?.value).toBe("de");
    expect(response.headers.get("Content-Security-Policy")).toContain(
      "script-src",
    );
  });

  it.each([
    ["https://example.test/de/sdsadas", "de", "/de"],
    [
      "https://example.test/de/sdsadas?source=broken#details",
      "en",
      "/en?source=broken#details",
    ],
    ["https://example.test/sdsadas", "de", "/de"],
    ["https://example.test/it/sdsadas", "en", "/en"],
  ])(
    "redirects unknown app path %s to the %s home page",
    async (url, locale, expectedPath) => {
      const request = createRequest(
        url,
        { host: "example.test" },
        { [SETTINGS_LOCALE_COOKIE]: locale },
      );

      const response = await getProxy()(request);

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(
        `https://example.test${expectedPath}`,
      );
      const expectedLocale = new URL(
        `https://example.test${expectedPath}`,
      ).pathname.startsWith("/de")
        ? "de"
        : "en";
      expect(response.cookies.get(SETTINGS_LOCALE_COOKIE)?.value).toBe(
        expectedLocale,
      );
      expect(response.cookies.get(NEXT_LOCALE_COOKIE)?.value).toBe(
        expectedLocale,
      );
      expect(createIntlMiddlewareMock).not.toHaveBeenCalled();
      expect(getSessionMock).not.toHaveBeenCalled();
    },
  );

  it("redirects dotted document paths while bypassing static asset requests", async () => {
    const documentRequest = createRequest(
      "https://example.test/de/missing.html",
      { accept: "text/html", host: "example.test" },
      { [SETTINGS_LOCALE_COOKIE]: "de" },
    );

    const documentResponse = await getProxy()(documentRequest);

    expect(documentResponse.status).toBe(307);
    expect(documentResponse.headers.get("location")).toBe(
      "https://example.test/de",
    );

    vi.clearAllMocks();
    const assetRequest = createRequest("https://example.test/missing.js", {
      accept: "*/*",
      host: "example.test",
      "sec-fetch-dest": "script",
    });

    const assetResponse = await getProxy()(assetRequest);

    expect(assetResponse.status).toBe(200);
    expect(assetResponse.headers.get("location")).toBeNull();
    expect(createIntlMiddlewareMock).not.toHaveBeenCalled();
    expect(getSessionMock).not.toHaveBeenCalled();
  });

  it("redirects logged-in users away from the login page", async () => {
    expect(proxyFn).toBeDefined();
    const { NextResponse } = await import("next/server");

    const baseResponse = new NextResponse(null, { status: 200 });
    baseResponse.headers.set("x-next-intl-locale", "de");
    handleI18nMock.mockReturnValue(baseResponse);

    getSessionMock.mockResolvedValue({
      session: { id: "s1" },
      user: { id: "u1" },
    });

    const request = createRequest(
      "https://example.test/de/anmelden",
      { host: "example.test" },
      { [SETTINGS_LOCALE_COOKIE]: "de" },
    );

    const response = await getProxy()(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://example.test/de");
    expect(response.cookies.get(SETTINGS_LOCALE_COOKIE)?.value).toBe("de");
    expect(response.cookies.get(NEXT_LOCALE_COOKIE)?.value).toBe("de");
  });

  it("allows unauthenticated users on the register page", async () => {
    expect(proxyFn).toBeDefined();
    const { NextResponse } = await import("next/server");

    const baseResponse = new NextResponse(null, { status: 200 });
    baseResponse.headers.set("x-next-intl-locale", "de");
    handleI18nMock.mockReturnValue(baseResponse);
    getSessionMock.mockResolvedValue(null);

    const request = createRequest(
      "https://example.test/de/registrieren",
      { host: "example.test" },
      { [SETTINGS_LOCALE_COOKIE]: "de" },
    );

    const response = await getProxy()(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("allows unauthenticated home in AllowUnauthenticated mode", async () => {
    expect(proxyFn).toBeDefined();
    const { NextResponse } = await import("next/server");
    process.env.AUTHENTICATION_METHOD = "AllowUnauthenticated";

    const baseResponse = new NextResponse(null, { status: 200 });
    baseResponse.headers.set("x-next-intl-locale", "de");
    handleI18nMock.mockReturnValue(baseResponse);
    getSessionMock.mockResolvedValue(null);

    const request = createRequest(
      "https://example.test/de",
      { host: "example.test" },
      { [SETTINGS_LOCALE_COOKIE]: "de" },
    );

    const response = await getProxy()(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("blocks unauthenticated settings in AllowUnauthenticated mode", async () => {
    expect(proxyFn).toBeDefined();
    const { NextResponse } = await import("next/server");
    process.env.AUTHENTICATION_METHOD = "AllowUnauthenticated";

    const baseResponse = new NextResponse(null, { status: 200 });
    baseResponse.headers.set("x-next-intl-locale", "de");
    handleI18nMock.mockReturnValue(baseResponse);
    getSessionMock.mockResolvedValue(null);

    const request = createRequest(
      "https://example.test/de/einstellungen",
      { host: "example.test" },
      { [SETTINGS_LOCALE_COOKIE]: "de" },
    );

    const response = await getProxy()(request);

    expect(response.status).toBe(307);
    const redirectUrl = response.headers.get("location");
    const parsed = redirectUrl ? new URL(redirectUrl) : null;
    expect(parsed?.pathname).toBe("/de/anmelden");
    expect(parsed?.searchParams.get("next")).toBe("/de/einstellungen");
  });

  it("allows restricted pages without internal session in External mode", async () => {
    expect(proxyFn).toBeDefined();
    const { NextResponse } = await import("next/server");
    process.env.AUTHENTICATION_METHOD = "External";

    const baseResponse = new NextResponse(null, { status: 200 });
    baseResponse.headers.set("x-next-intl-locale", "de");
    handleI18nMock.mockReturnValue(baseResponse);
    getSessionMock.mockResolvedValue(null);

    const request = createRequest(
      "https://example.test/de/einstellungen",
      { host: "example.test" },
      { [SETTINGS_LOCALE_COOKIE]: "de" },
    );

    const response = await getProxy()(request);

    expect(response.status).toBe(200);
    expect(getSessionMock).not.toHaveBeenCalled();
  });

  it.each([
    "/de/anmelden",
    "/de/passwort-vergessen",
    "/de/passwort-zuruecksetzen",
  ])("redirects auth page %s to home in External mode", async (pathname) => {
    expect(proxyFn).toBeDefined();
    const { NextResponse } = await import("next/server");
    process.env.AUTHENTICATION_METHOD = "External";

    const baseResponse = new NextResponse(null, { status: 200 });
    baseResponse.headers.set("x-next-intl-locale", "de");
    handleI18nMock.mockReturnValue(baseResponse);

    const request = createRequest(
      `https://example.test${pathname}`,
      { host: "example.test" },
      { [SETTINGS_LOCALE_COOKIE]: "de" },
    );

    const response = await getProxy()(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://example.test/de");
    expect(getSessionMock).not.toHaveBeenCalled();
  });

  it("blocks disallowed origins during development", async () => {
    expect(proxyFn).toBeDefined();
    const { NextResponse } = await import("next/server");

    const baseResponse = new NextResponse(null, { status: 200 });
    baseResponse.headers.set("x-next-intl-locale", "de");
    handleI18nMock.mockReturnValue(baseResponse);

    const originalNodeEnv = process.env.NODE_ENV;
    const originalAllowed = process.env.ALLOWED_DEV_ORIGINS;
    process.env.NODE_ENV = "development";
    process.env.ALLOWED_DEV_ORIGINS = "https://allowed.example.test";

    try {
      getSessionMock.mockResolvedValue({
        session: { id: "s1" },
        user: { id: "u1" },
      });

      const request = createRequest(
        "https://example.test/de",
        {
          host: "example.test",
          origin: "https://blocked.example.test",
        },
        { [SETTINGS_LOCALE_COOKIE]: "de" },
      );

      const response = await getProxy()(request);

      expect(response.status).toBe(403);
      expect(await response.text()).toBe("Forbidden");
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
      process.env.ALLOWED_DEV_ORIGINS = originalAllowed;
    }
  });

  it("applies security headers on successful responses", async () => {
    expect(proxyFn).toBeDefined();
    const { NextResponse } = await import("next/server");

    const baseResponse = new NextResponse(null, { status: 200 });
    baseResponse.headers.set("x-next-intl-locale", "de");
    handleI18nMock.mockReturnValue(baseResponse);

    getSessionMock.mockResolvedValue({
      session: { id: "s1" },
      user: { id: "u1" },
    });

    const originalNodeEnv = process.env.NODE_ENV;
    const originalHttps = process.env.HTTPS;
    process.env.NODE_ENV = "production";
    process.env.HTTPS = "true";

    try {
      const request = createRequest(
        "https://example.test/de",
        { host: "example.test" },
        { [SETTINGS_LOCALE_COOKIE]: "de" },
      );

      const response = await getProxy()(request);

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Security-Policy")).toContain(
        "default-src 'self'",
      );
      expect(response.headers.get("Content-Security-Policy")).toContain(
        "upgrade-insecure-requests",
      );
      const csp = response.headers.get("Content-Security-Policy");
      expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
      expect(csp).not.toContain("'unsafe-eval'");
      expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
      expect(response.headers.get("x-middleware-request-x-nonce")).toBeTruthy();
      expect(
        response.headers.get("x-middleware-request-content-security-policy"),
      ).toBe(csp);
      expect(response.headers.get("X-Frame-Options")).toBe("DENY");
      expect(response.cookies.get(NEXT_LOCALE_COOKIE)?.value).toBe("de");
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
      process.env.HTTPS = originalHttps;
    }
  });
});
