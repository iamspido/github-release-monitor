import type { NextRequest, NextResponse } from "next/server";
import { defaultLocale, locales } from "@/i18n/routing";
import { logger } from "@/lib/logger";
import {
  NEXT_LOCALE_COOKIE,
  nextLocaleCookieOptions,
  SETTINGS_LOCALE_COOKIE,
  settingsLocaleCookieOptions,
} from "@/lib/settings-locale-cookie";

export type ProxyLocale = (typeof locales)[number];

const localeSet = new Set<string>(locales as readonly string[]);
const logSettings = logger.withScope("Settings");
const SETTINGS_LOCALE_API_PATH = "/api/settings-locale";
const SETTINGS_LOCALE_FETCH_TIMEOUT_MS = 2000;

export async function fetchSettingsLocale(
  request: NextRequest,
  options?: { fetchImpl?: typeof fetch },
): Promise<ProxyLocale> {
  const fetchImpl = options?.fetchImpl ?? fetch;
  const apiUrls = buildSettingsLocaleApiUrls(request);
  const attemptSummaries: string[] = [];
  let lastError: unknown = null;

  for (const apiUrl of apiUrls) {
    try {
      const response = await fetchImpl(apiUrl, {
        cache: "no-store",
        signal: AbortSignal.timeout(SETTINGS_LOCALE_FETCH_TIMEOUT_MS),
        headers: {
          "cache-control": "no-store",
          "x-from-middleware": "1",
        },
      });

      if (!response.ok) {
        attemptSummaries.push(
          `${apiUrl.toString()} (status=${response.status})`,
        );
        logSettings.warn(
          `Failed to fetch settings locale (status=${response.status}) from ${apiUrl.origin}. Trying next candidate.`,
        );
        continue;
      }

      const data = (await response.json()) as { locale?: string | null };
      if (data.locale && localeSet.has(data.locale)) {
        return data.locale as ProxyLocale;
      }

      attemptSummaries.push(
        `${apiUrl.toString()} (invalid locale='${data.locale ?? "undefined"}')`,
      );
      logSettings.warn(
        `Received invalid locale '${data.locale ?? "undefined"}' from ${apiUrl.origin}. Trying next candidate.`,
      );
    } catch (error) {
      lastError = error;
      attemptSummaries.push(`${apiUrl.toString()} (fetch failed)`);
      logSettings.warn(
        `Error fetching settings locale from ${apiUrl.origin}. Trying next candidate.`,
        error,
      );
    }
  }

  if (apiUrls.length > 0) {
    logSettings.error(
      `Error fetching settings locale in middleware. Attempts: ${attemptSummaries.join("; ")}. Falling back to default locale.`,
      lastError || undefined,
    );
  } else {
    logSettings.error(
      "Error fetching settings locale in middleware. No candidate API origins resolved. Falling back to default locale.",
      lastError || undefined,
    );
  }

  return defaultLocale;
}

export function getLocaleFromCookies(request: NextRequest): ProxyLocale | null {
  const cookieLocale =
    request.cookies.get(SETTINGS_LOCALE_COOKIE)?.value ??
    request.cookies.get(NEXT_LOCALE_COOKIE)?.value;
  if (cookieLocale && localeSet.has(cookieLocale)) {
    return cookieLocale as ProxyLocale;
  }
  return null;
}

export function attachLocaleCookies(
  response: NextResponse,
  locale: ProxyLocale,
) {
  response.cookies.set(
    SETTINGS_LOCALE_COOKIE,
    locale,
    settingsLocaleCookieOptions,
  );
  response.cookies.set(NEXT_LOCALE_COOKIE, locale, nextLocaleCookieOptions);
}

export function buildSettingsLocaleApiUrls(request: NextRequest): URL[] {
  const origins: string[] = [];
  const seen = new Set<string>();
  const configuredOrigins = getConfiguredSettingsLocaleApiOrigins();

  const addOrigin = (candidate?: string | null) => {
    if (!candidate) return;
    const normalized = normalizeOrigin(candidate);
    if (
      !normalized ||
      seen.has(normalized) ||
      !isAllowedSettingsLocaleOrigin(normalized, configuredOrigins)
    ) {
      return;
    }
    seen.add(normalized);
    origins.push(normalized);
  };

  configuredOrigins.forEach((origin) => {
    addOrigin(origin);
  });

  const requestOrigin = request.nextUrl?.origin;
  if (requestOrigin && isLoopbackOrigin(requestOrigin)) {
    addOrigin(requestOrigin);
  }

  const fallbackPorts = uniqueDefined([
    normalizePort(process.env.PORT),
    "3000",
  ]);

  for (const port of fallbackPorts) {
    addOrigin(`http://127.0.0.1:${port}`);
    addOrigin(`http://localhost:${port}`);
    addOrigin(`http://[::1]:${port}`);
  }

  if (origins.length === 0) {
    addOrigin("http://127.0.0.1:3000");
  }

  return origins.map((origin) => new URL(SETTINGS_LOCALE_API_PATH, origin));
}

function uniqueDefined(values: Array<string | undefined | null>): string[] {
  const result: string[] = [];
  for (const value of values) {
    if (!value) continue;
    if (!result.includes(value)) {
      result.push(value);
    }
  }
  return result;
}

function normalizePort(value?: string | null): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  const numericPort = Number(trimmed);
  if (
    !Number.isInteger(numericPort) ||
    numericPort < 1 ||
    numericPort > 65535
  ) {
    return undefined;
  }
  return String(numericPort);
}

function getConfiguredSettingsLocaleApiOrigins(): string[] {
  const raw = process.env.SETTINGS_LOCALE_ALLOWED_ORIGINS;
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => normalizeOrigin(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1"
  );
}

function isLoopbackOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin);
    return isLoopbackHostname(parsed.hostname);
  } catch {
    return false;
  }
}

function isAllowedSettingsLocaleOrigin(
  origin: string,
  configuredOrigins: string[],
): boolean {
  if (isLoopbackOrigin(origin)) {
    return true;
  }
  return configuredOrigins.includes(origin);
}

function normalizeProtocolValue(
  value: string | undefined | null,
): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return undefined;
  return trimmed.endsWith(":") ? trimmed.slice(0, -1) : trimmed;
}

function normalizeOrigin(candidate: string): string | null {
  if (!candidate) {
    return null;
  }
  const trimmed = candidate.trim();
  if (!trimmed) {
    return null;
  }

  const tryNormalize = (value: string): string | null => {
    try {
      const url = new URL(value);
      if (!url.protocol || !url.hostname) {
        return null;
      }
      if (url.username || url.password) {
        return null;
      }

      const isZeroAddress = url.hostname === "0.0.0.0" || url.hostname === "::";
      const hostname = isZeroAddress
        ? url.hostname === "::"
          ? "::1"
          : "127.0.0.1"
        : url.hostname;

      const protocol = isZeroAddress
        ? "http"
        : (normalizeProtocolValue(url.protocol) ?? "http");
      if (protocol !== "http" && protocol !== "https") {
        return null;
      }

      const needsBrackets = hostname.includes(":");
      const hostWithPort = url.port
        ? needsBrackets
          ? `[${hostname}]:${url.port}`
          : `${hostname}:${url.port}`
        : needsBrackets
          ? `[${hostname}]`
          : hostname;

      return `${protocol}://${hostWithPort}`;
    } catch {
      return null;
    }
  };

  return (
    tryNormalize(trimmed) ||
    tryNormalize(`http://${trimmed}`) ||
    tryNormalize(`https://${trimmed}`)
  );
}
