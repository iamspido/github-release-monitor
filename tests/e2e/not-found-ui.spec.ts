import { expect, test } from "./fixtures/test";

test("a stale locale cookie does not override the configured locale", async ({
  request,
}) => {
  const response = await request.get("/de/sdsadas", {
    headers: { cookie: "grm.locale=de" },
    maxRedirects: 0,
  });

  expect(response.status()).toBe(307);
  expect(
    new URL(response.headers().location, "http://localhost").pathname,
  ).toBe("/en");
});

test("unknown localized path does not override a different configured locale", async ({
  request,
}) => {
  const mismatchedResponse = await request.get("/de/sdsadas", {
    maxRedirects: 0,
  });

  expect(mismatchedResponse.status()).toBe(307);
  expect(
    new URL(mismatchedResponse.headers().location, "http://localhost").pathname,
  ).toBe("/en");
});

test("unknown dotted document path redirects to the configured home page", async ({
  request,
}) => {
  const response = await request.get("/de/missing.html", {
    headers: {
      accept: "text/html",
      cookie: "grm.locale=de",
      "sec-fetch-dest": "document",
    },
    maxRedirects: 0,
  });

  expect(response.status()).toBe(307);
  expect(
    new URL(response.headers().location, "http://localhost").pathname,
  ).toBe("/en");
});
