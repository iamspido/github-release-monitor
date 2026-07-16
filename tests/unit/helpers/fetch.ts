import { type MockedFunction, vi } from "vitest";

type MockFetchResponseInit = {
  status?: number;
  statusText?: string;
  headers?: HeadersInit;
  json?: unknown;
  text?: string;
  body?: BodyInit | null;
  bytes?: Uint8Array;
};

export function installFetchMock(): MockedFunction<typeof fetch> {
  global.fetch = vi.fn<typeof fetch>();
  return vi.mocked(global.fetch);
}

export function mockFetchResponse({
  status = 200,
  statusText = status >= 200 && status < 300 ? "OK" : "",
  headers,
  json,
  text,
  body,
  bytes,
}: MockFetchResponseInit = {}): Response {
  const responseHeaders = new Headers(headers);
  let responseBody: BodyInit | null = body ?? null;

  if (json !== undefined) {
    if (!responseHeaders.has("content-type")) {
      responseHeaders.set("content-type", "application/json");
    }
    responseBody = JSON.stringify(json);
  } else if (text !== undefined) {
    responseBody = text;
  } else if (bytes !== undefined) {
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    responseBody = new Blob([buffer]);
  }

  return new Response(responseBody, {
    headers: responseHeaders,
    status,
    statusText,
  });
}

export function fetchCallInit(call: Parameters<typeof fetch>): RequestInit {
  const init = call[1];
  if (!init) {
    throw new Error("Expected fetch call to include RequestInit");
  }
  return init;
}

export function fetchCallHeaders(call: Parameters<typeof fetch>): HeadersInit {
  const headers = fetchCallInit(call).headers;
  if (!headers) {
    throw new Error("Expected fetch call to include headers");
  }
  return headers;
}

export function fetchCallBodyText(call: Parameters<typeof fetch>): string {
  const body = fetchCallInit(call).body;
  if (typeof body !== "string") {
    throw new Error("Expected fetch call body to be a string");
  }
  return body;
}

export function headerRecord(headers: HeadersInit): Record<string, string> {
  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }
  return headers;
}
