import { afterEach, describe, expect, it, vi } from "vitest";
import {
  consumeResponseWithTimeout,
  discardResponseWithTimeout,
  fetchWithTimeout,
  OutboundRequestTimeoutError,
} from "@/lib/http/fetch-with-timeout";

describe("fetchWithTimeout", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("aborts an outbound request after the configured deadline", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_url: string, options?: RequestInit): Promise<Response> =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () => reject(options.signal?.reason),
            { once: true },
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const request = fetchWithTimeout("https://example.test/data", {}, 25);
    const rejection = expect(request).rejects.toBeInstanceOf(
      OutboundRequestTimeoutError,
    );
    await vi.advanceTimersByTimeAsync(25);
    await rejection;

    const signal = fetchMock.mock.calls[0]?.[1]?.signal;
    expect(signal?.aborted).toBe(true);
  });

  it("forwards a caller abort without replacing its reason", async () => {
    const caller = new AbortController();
    const reason = new Error("caller cancelled");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, options?: RequestInit): Promise<Response> =>
          new Promise((_resolve, reject) => {
            options?.signal?.addEventListener(
              "abort",
              () => reject(options.signal?.reason),
              { once: true },
            );
          }),
      ),
    );

    const request = fetchWithTimeout(
      "https://example.test/data",
      { signal: caller.signal },
      1_000,
    );
    caller.abort(reason);

    await expect(request).rejects.toBe(reason);
  });

  it("keeps the deadline active while the response body is read", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, options?: RequestInit) => {
        const body = new ReadableStream({
          start(controller) {
            options?.signal?.addEventListener(
              "abort",
              () => controller.error(options.signal?.reason),
              { once: true },
            );
          },
        });
        return Promise.resolve(new Response(body));
      }),
    );

    const response = await fetchWithTimeout(
      "https://example.test/slow-body",
      {},
      25,
    );
    const body = consumeResponseWithTimeout(response, (result) =>
      result.text(),
    );
    const rejection = expect(body).rejects.toBeInstanceOf(
      OutboundRequestTimeoutError,
    );

    await vi.advanceTimersByTimeAsync(25);
    await rejection;
  });

  it("cancels a discarded response body before releasing its deadline", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    let requestSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, options?: RequestInit) => {
        requestSignal = options?.signal ?? undefined;
        return Promise.resolve(
          new Response(
            new ReadableStream({
              cancel,
            }),
          ),
        );
      }),
    );

    const response = await fetchWithTimeout(
      "https://example.test/ignored-body",
      {},
      25,
    );
    await discardResponseWithTimeout(response);
    await vi.advanceTimersByTimeAsync(25);

    expect(cancel).toHaveBeenCalledOnce();
    expect(requestSignal?.aborted).toBe(false);
  });
});
