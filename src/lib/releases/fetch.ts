import { isRetryableFetchError } from "@/lib/fetch-retry";
import {
  consumeResponseWithTimeout,
  discardResponseWithTimeout,
  fetchWithAllowedRedirects,
  fetchWithTimeout,
} from "@/lib/http/fetch-with-timeout";
import { log } from "@/lib/server-action-helpers";

const warnRetry = (message: string) => log.warn(message);

const DEFAULT_FETCH_RETRY_ATTEMPTS = 3;
const DEFAULT_FETCH_RETRY_DELAY_MS = 500;
const DEFAULT_RESPONSE_PARSE_ATTEMPTS = 3;

async function wait(delayMs: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}

export type FetchRetryContext = {
  description?: string;
  maxAttempts?: number;
  initialDelayMs?: number;
  parseAttempts?: number;
  timeoutMs?: number;
  deadlineMs?: number;
  allowedRedirectBaseUrl?: string;
};

export async function fetchWithRetry(
  url: string,
  options: RequestInit,
  context?: FetchRetryContext,
): Promise<Response> {
  const description = context?.description ?? url;
  const maxAttempts = context?.maxAttempts ?? DEFAULT_FETCH_RETRY_ATTEMPTS;
  const initialDelayMs =
    context?.initialDelayMs ?? DEFAULT_FETCH_RETRY_DELAY_MS;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return context?.allowedRedirectBaseUrl
        ? await fetchWithAllowedRedirects(
            url,
            options,
            context.allowedRedirectBaseUrl,
            context.timeoutMs,
          )
        : await fetchWithTimeout(url, options, context?.timeoutMs);
    } catch (error) {
      const shouldRetry =
        attempt < maxAttempts &&
        isRetryableFetchError(error, { warn: warnRetry });
      if (!shouldRetry) {
        throw error;
      }

      const delayMs = initialDelayMs * 2 ** (attempt - 1);
      log.warn(
        `Retrying ${description} in ${delayMs}ms (attempt ${attempt + 1}/${maxAttempts}) due to fetch error.`,
        error,
      );
      await wait(delayMs);
    }
  }

  throw new Error(
    `Failed to fetch ${description} after ${maxAttempts} attempts.`,
  );
}

export async function fetchJsonResponseWithRetry<T>(
  url: string,
  options: RequestInit,
  context?: FetchRetryContext,
): Promise<{ response: Response; data?: T }> {
  const description = context?.description ?? url;
  const parseAttempts =
    context?.parseAttempts ?? DEFAULT_RESPONSE_PARSE_ATTEMPTS;
  const initialDelayMs =
    context?.initialDelayMs ?? DEFAULT_FETCH_RETRY_DELAY_MS;

  for (let attempt = 1; attempt <= parseAttempts; attempt += 1) {
    const response = await fetchWithRetry(url, options, context);

    if (!response.ok) {
      return { response };
    }

    try {
      const data = await consumeResponseWithTimeout(
        response,
        async (result) => (await result.json()) as T,
      );
      return { response, data };
    } catch (error) {
      const shouldRetry =
        attempt < parseAttempts &&
        isRetryableFetchError(error, { warn: warnRetry });
      if (!shouldRetry) {
        throw error;
      }

      const delayMs = initialDelayMs * 2 ** (attempt - 1);
      log.warn(
        `Retrying ${description} JSON parse in ${delayMs}ms (attempt ${attempt + 1}/${parseAttempts}) due to response parse error.`,
        error,
      );
      await wait(delayMs);
    }
  }

  throw new Error(
    `Failed to parse JSON for ${description} after ${parseAttempts} attempts.`,
  );
}

export type AuthMode = "none" | "token" | "bearer" | "basic";

export function isRateLimitedResponse(
  response: Response | null | undefined,
): boolean {
  return Boolean(
    response &&
      (response.status === 429 ||
        (response.status === 403 && response.headers.get("retry-after"))),
  );
}

export async function fetchJsonResponseWithRetryAuthChain<T>(
  url: string,
  chain: Array<{ mode: AuthMode; options: RequestInit }>,
  context?: FetchRetryContext,
): Promise<{ response: Response; data?: T; mode: AuthMode }> {
  if (chain.length === 0) {
    throw new Error("fetchJsonResponseWithRetryAuthChain: empty chain");
  }

  const description = context?.description ?? url;

  for (let i = 0; i < chain.length; i += 1) {
    const candidate = chain[i];
    const isLast = i === chain.length - 1;

    const remainingMs = context?.deadlineMs
      ? context.deadlineMs - Date.now()
      : undefined;
    if (remainingMs !== undefined && remainingMs <= 0) {
      throw new Error(`${description} exceeded its shared deadline.`);
    }
    const timeoutMs =
      remainingMs === undefined
        ? context?.timeoutMs
        : Math.min(context?.timeoutMs ?? remainingMs, remainingMs);

    const result = await fetchJsonResponseWithRetry<T>(url, candidate.options, {
      ...context,
      timeoutMs,
      description:
        candidate.mode === "none"
          ? description
          : `${description} (${candidate.mode})`,
    });

    // `304 Not Modified` is a valid response for our ETag usage; don't fall back.
    if (result.response.status === 304) {
      await discardResponseWithTimeout(result.response);
      return { ...result, mode: candidate.mode };
    }

    // For auth-related errors, try the next candidate (if any).
    if (
      !isLast &&
      (result.response.status === 401 ||
        (result.response.status === 403 &&
          !isRateLimitedResponse(result.response)))
    ) {
      await discardResponseWithTimeout(result.response);
      continue;
    }

    return { ...result, mode: candidate.mode };
  }

  // Should never happen due to early return.
  return {
    response: new Response(null, { status: 500, statusText: "Unknown Error" }),
    mode: "none",
  };
}

export async function fetchResponseWithRetryAuthChain(
  url: string,
  chain: Array<{ mode: AuthMode; options: RequestInit }>,
  context?: FetchRetryContext,
): Promise<{ response: Response; mode: AuthMode }> {
  if (chain.length === 0) {
    throw new Error("fetchResponseWithRetryAuthChain: empty chain");
  }

  const description = context?.description ?? url;

  for (let i = 0; i < chain.length; i += 1) {
    const candidate = chain[i];
    const isLast = i === chain.length - 1;

    const response = await fetchWithRetry(url, candidate.options, {
      ...context,
      description:
        candidate.mode === "none"
          ? description
          : `${description} (${candidate.mode})`,
    });

    // `304 Not Modified` is a valid response for our ETag usage; don't fall back.
    if (response.status === 304) {
      await discardResponseWithTimeout(response);
      return { response, mode: candidate.mode };
    }

    // For auth-related errors, try the next candidate (if any).
    if (
      !isLast &&
      (response.status === 401 ||
        (response.status === 403 && !isRateLimitedResponse(response)))
    ) {
      await discardResponseWithTimeout(response);
      continue;
    }

    return { response, mode: candidate.mode };
  }

  // Should never happen due to early return.
  return {
    response: new Response(null, { status: 500, statusText: "Unknown Error" }),
    mode: "none",
  };
}
