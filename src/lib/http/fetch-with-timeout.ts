export const DEFAULT_OUTBOUND_REQUEST_TIMEOUT_MS = 15_000;

export class OutboundRequestTimeoutError extends Error {
  readonly code = "ETIMEDOUT";

  constructor(url: string, timeoutMs: number) {
    super(`Request to ${url} timed out after ${timeoutMs}ms.`);
    this.name = "OutboundRequestTimeoutError";
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
