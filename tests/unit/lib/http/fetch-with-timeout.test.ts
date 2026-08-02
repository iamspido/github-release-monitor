import { afterEach, describe, expect, it, vi } from "vitest";
import {
  consumeResponseWithTimeout,
  discardResponseWithTimeout,
  fetchWithAllowedRedirects,
  fetchWithTimeout,
  OutboundRedirectError,
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

  it("follows redirects that stay within the allowed origin and base path", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "../repos/owner/repo/releases" },
        }),
      )
      .mockResolvedValueOnce(new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await fetchWithAllowedRedirects(
      "https://forgejo.example.test/code/api/v1/user",
      { headers: { Authorization: "token secret" } },
      "https://forgejo.example.test/code",
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      "https://forgejo.example.test/code/api/repos/owner/repo/releases",
    );
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      redirect: "manual",
      headers: { Authorization: "token secret" },
    });
  });

  it("shares one timeout budget across the complete redirect chain", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            setTimeout(
              () =>
                resolve(
                  new Response(null, {
                    status: 302,
                    headers: { location: "next" },
                  }),
                ),
              20,
            );
          }),
      )
      .mockImplementationOnce(
        (_url, options) =>
          new Promise((_resolve, reject) => {
            options?.signal?.addEventListener(
              "abort",
              () => reject(options.signal?.reason),
              { once: true },
            );
          }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const request = fetchWithAllowedRedirects(
      "https://forgejo.example.test/code/api/v1/user",
      {},
      "https://forgejo.example.test/code",
      25,
    );
    const rejection = expect(request).rejects.toBeInstanceOf(
      OutboundRequestTimeoutError,
    );

    await vi.advanceTimersByTimeAsync(20);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5);
    await rejection;
  });

  it("follows equivalent percent-encoded base paths", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "/%7eForgejo%2Ecode/api/v1/user" },
        }),
      )
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await fetchWithAllowedRedirects(
      "https://forgejo.example.test/~Forgejo.code/api/v1/user",
      {},
      "https://forgejo.example.test/~Forgejo.code",
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("follows redirects using literal forms of ID-encoded base-path characters", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: {
            location: "/code[prod]|secondary/api/v1/user",
          },
        }),
      )
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await fetchWithAllowedRedirects(
      "https://forgejo.example.test/code%5Bprod%5D%7Csecondary/api/v1/user",
      {},
      "https://forgejo.example.test/code%5Bprod%5D%7Csecondary",
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("allows encoded separators in a locally constructed initial URL", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await fetchWithAllowedRedirects(
      "https://forgejo.example.test/code/api/v1/repos/owner/repo/commits/release%2Fv2.1.0",
      {},
      "https://forgejo.example.test/code",
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("follows an in-base redirect containing an encoded repository ref", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: {
            location: "/code/api/v1/repos/owner/repo/commits/release%2Fv2.1.0",
          },
        }),
      )
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await fetchWithAllowedRedirects(
      "https://forgejo.example.test/code/api/v1/user",
      {},
      "https://forgejo.example.test/code",
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    "https://other.example.test/code/api/v1/user",
    "https://forgejo.example.test/other/api/v1/user",
    "https://forgejo.example.test/code%2Fother/api/v1/user",
    "https://forgejo.example.test/code/safe%2F..%2F..%2Fother/api/v1/user",
    "https://forgejo.example.test/code/safe%5C..%5C..%5Cother/api/v1/user",
    "https://forgejo.example.test/code/safe%252F..%252F..%252Fother/api/v1/user",
    "https://forgejo.example.test/code/safe%25252F..%25252F..%25252Fother/api/v1/user",
  ])(
    "rejects a redirect outside the allowed base boundary: %s",
    async (location) => {
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(null, {
          status: 302,
          headers: { location },
        }),
      );
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        fetchWithAllowedRedirects(
          "https://forgejo.example.test/code/api/v1/user",
          { headers: { Authorization: "token secret" } },
          "https://forgejo.example.test/code",
        ),
      ).rejects.toBeInstanceOf(OutboundRedirectError);
      expect(fetchMock).toHaveBeenCalledOnce();
    },
  );
});
