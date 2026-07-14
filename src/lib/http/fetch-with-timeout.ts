export const DEFAULT_OUTBOUND_REQUEST_TIMEOUT_MS = 15_000;

export class OutboundRequestTimeoutError extends Error {
  readonly code = "ETIMEDOUT";

  constructor(url: string, timeoutMs: number) {
    super(`Request to ${url} timed out after ${timeoutMs}ms.`);
    this.name = "OutboundRequestTimeoutError";
  }
}

export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = DEFAULT_OUTBOUND_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const externalSignal = options.signal;
  const forwardAbort = () => controller.abort(externalSignal?.reason);

  if (externalSignal?.aborted) {
    forwardAbort();
  } else {
    externalSignal?.addEventListener("abort", forwardAbort, { once: true });
  }

  const timeout = setTimeout(() => {
    controller.abort(new OutboundRequestTimeoutError(url, timeoutMs));
  }, timeoutMs);
  if (typeof timeout === "object" && "unref" in timeout) {
    timeout.unref();
  }

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", forwardAbort);
  }
}
