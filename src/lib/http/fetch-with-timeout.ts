export const DEFAULT_OUTBOUND_REQUEST_TIMEOUT_MS = 15_000;

export class OutboundRequestTimeoutError extends Error {
  readonly code = "ETIMEDOUT";

  constructor(url: string, timeoutMs: number) {
    super(`Request to ${url} timed out after ${timeoutMs}ms.`);
    this.name = "OutboundRequestTimeoutError";
  }
}

export class OutboundRedirectError extends Error {
  readonly code = "ERR_OUTBOUND_REDIRECT";

  constructor(message: string) {
    super(message);
    this.name = "OutboundRedirectError";
  }
}

type ResponseTimeout = {
  cleanup: () => void;
};

const responseTimeouts = new WeakMap<Response, ResponseTimeout>();

export async function consumeResponseWithTimeout<T>(
  response: Response,
  consume: (response: Response) => Promise<T>,
): Promise<T> {
  try {
    return await consume(response);
  } finally {
    const responseTimeout = responseTimeouts.get(response);
    responseTimeout?.cleanup();
    responseTimeouts.delete(response);
  }
}

export async function discardResponseWithTimeout(
  response: Response,
): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The response is intentionally being discarded. A body that already
    // errored or was consumed needs no further handling here.
  } finally {
    const responseTimeout = responseTimeouts.get(response);
    responseTimeout?.cleanup();
    responseTimeouts.delete(response);
  }
}

export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = DEFAULT_OUTBOUND_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const externalSignal = options.signal;
  let response: Response | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    if (timeout) clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", forwardAbort);
  };
  const forwardAbort = () => {
    controller.abort(externalSignal?.reason);
    cleanup();
    if (response) responseTimeouts.delete(response);
  };

  timeout = setTimeout(() => {
    controller.abort(new OutboundRequestTimeoutError(url, timeoutMs));
    cleanup();
    if (response) responseTimeouts.delete(response);
  }, timeoutMs);
  if (typeof timeout === "object" && "unref" in timeout) {
    timeout.unref();
  }

  if (externalSignal?.aborted) {
    forwardAbort();
  } else {
    externalSignal?.addEventListener("abort", forwardAbort, { once: true });
  }

  try {
    response = await fetch(url, { ...options, signal: controller.signal });
    if (response.body) {
      responseTimeouts.set(response, { cleanup });
    } else {
      cleanup();
    }
    return response;
  } catch (error) {
    cleanup();
    throw error;
  }
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const DEFAULT_MAX_ALLOWED_REDIRECTS = 5;

function canonicalizeBoundaryPathname(pathname: string): string | null {
  if (/%(?![0-9a-f]{2})/i.test(pathname)) return null;

  const idSafePathname = pathname.replace(
    /\[|\]|\|/g,
    (character) =>
      `%${character.codePointAt(0)?.toString(16).toUpperCase().padStart(2, "0")}`,
  );
  const canonicalPathname = idSafePathname.replace(
    /%([0-9a-f]{2})/gi,
    (encoded, hex: string) => {
      const character = String.fromCharCode(Number.parseInt(hex, 16));
      return /^[a-z0-9_~-]$/i.test(character)
        ? character
        : encoded.toUpperCase();
    },
  );
  return canonicalPathname
    .split("/")
    .map((segment) => {
      const decodedDots = segment.replace(/%2E/gi, ".");
      return decodedDots === "." || decodedDots === ".."
        ? segment
        : decodedDots;
    })
    .join("/");
}

function canonicalizeProxyDecodedPathname(pathname: string): string | null {
  let currentPathname = canonicalizeBoundaryPathname(pathname);
  if (currentPathname === null) return null;

  // A reverse proxy and the upstream application may each decode a path once.
  // Resolve boundary-sensitive escapes until the path is stable so nested
  // encodings such as `%252F` cannot conceal traversal from this check.
  for (let pass = 0; pass < 8; pass += 1) {
    const decodedPathname = currentPathname
      .replace(/%25(?=(?:25)*(?:2f|5c|2e))/gi, "%")
      .replace(/%(?:2f|5c)/gi, "/")
      .replace(/%2e/gi, ".");
    const canonicalDecodedPathname =
      canonicalizeBoundaryPathname(decodedPathname);
    if (canonicalDecodedPathname === null) return null;

    const normalizedPathname = new URL(
      `https://boundary.test${canonicalDecodedPathname.startsWith("/") ? "" : "/"}${canonicalDecodedPathname}`,
    ).pathname;
    const nextPathname = canonicalizeBoundaryPathname(normalizedPathname);
    if (nextPathname === null) return null;
    if (nextPathname === currentPathname) return nextPathname;
    currentPathname = nextPathname;
  }

  return null;
}

function isPathWithinBasePath(pathname: string, basePathname: string): boolean {
  const basePath = basePathname.replace(/\/+$/, "");
  return (
    basePath === "" ||
    pathname === basePath ||
    pathname.startsWith(`${basePath}/`)
  );
}

export function isUrlWithinBaseUrl(url: URL, baseUrl: URL): boolean {
  if (url.username || url.password || url.origin !== baseUrl.origin) {
    return false;
  }

  const pathname = canonicalizeBoundaryPathname(url.pathname);
  const basePathname = canonicalizeBoundaryPathname(baseUrl.pathname);
  if (pathname === null || basePathname === null) return false;

  // Some reverse proxies decode encoded separators before routing. Validate
  // both interpretations so legitimate refs such as `release/v2` remain
  // usable while decoded traversal cannot escape the configured base path.
  const proxyDecodedPathname = canonicalizeProxyDecodedPathname(url.pathname);
  const proxyDecodedBasePathname = canonicalizeProxyDecodedPathname(
    baseUrl.pathname,
  );
  return (
    proxyDecodedPathname !== null &&
    proxyDecodedBasePathname !== null &&
    isPathWithinBasePath(pathname, basePathname) &&
    isPathWithinBasePath(proxyDecodedPathname, proxyDecodedBasePathname)
  );
}

export async function fetchWithAllowedRedirects(
  url: string,
  options: RequestInit,
  allowedBaseUrl: string,
  timeoutMs = DEFAULT_OUTBOUND_REQUEST_TIMEOUT_MS,
  maxRedirects = DEFAULT_MAX_ALLOWED_REDIRECTS,
): Promise<Response> {
  const baseUrl = new URL(allowedBaseUrl);
  let currentUrl = new URL(url);
  const deadline = Date.now() + timeoutMs;
  if (!isUrlWithinBaseUrl(currentUrl, baseUrl)) {
    throw new OutboundRedirectError(
      "Outbound request URL is outside the configured base URL.",
    );
  }

  for (let redirectCount = 0; ; redirectCount += 1) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new OutboundRequestTimeoutError(url, timeoutMs);
    }
    const response = await fetchWithTimeout(
      currentUrl.href,
      { ...options, redirect: "manual" },
      remainingMs,
    );
    if (!REDIRECT_STATUSES.has(response.status)) return response;

    const location = response.headers.get("location");
    if (!location) return response;

    let redirectUrl: URL;
    try {
      redirectUrl = new URL(location, currentUrl);
    } catch {
      await discardResponseWithTimeout(response);
      throw new OutboundRedirectError(
        "Outbound response contained an invalid redirect location.",
      );
    }

    if (!isUrlWithinBaseUrl(redirectUrl, baseUrl)) {
      await discardResponseWithTimeout(response);
      throw new OutboundRedirectError(
        "Outbound redirect left the configured base URL.",
      );
    }
    if (redirectCount >= maxRedirects) {
      await discardResponseWithTimeout(response);
      throw new OutboundRedirectError(
        "Outbound request exceeded the allowed redirect count.",
      );
    }

    await discardResponseWithTimeout(response);
    currentUrl = redirectUrl;
  }
}
