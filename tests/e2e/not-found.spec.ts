import { expect, test } from "./fixtures/test";

test("unknown path without a locale redirects to the localized home page", async ({
  request,
}) => {
  const response = await request.get("/this-page-does-not-exist", {
    maxRedirects: 0,
  });

  expect(response.status()).toBe(307);
  expect(
    new URL(response.headers().location, "http://localhost").pathname,
  ).toBe("/en");
});

test("unknown paths resembling reserved prefixes still redirect", async ({
  request,
}) => {
  for (const pathname of [
    "/apiary",
    "/trpc-tools",
    "/_nextish",
    "/_vercel-app",
  ]) {
    const response = await request.get(pathname, {
      maxRedirects: 0,
    });

    expect(response.status(), pathname).toBe(307);
    expect(
      new URL(response.headers().location, "http://localhost").pathname,
      pathname,
    ).toBe("/en");
  }
});
