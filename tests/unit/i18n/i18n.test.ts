import { beforeEach, describe, expect, it, vi } from "vitest";

type RequestConfigCallback = (args: {
  requestLocale: Promise<string>;
}) => Promise<{
  locale: string;
  messages: unknown;
}>;

let capturedGetRequestCb: RequestConfigCallback | undefined;

vi.mock("next-intl/server", () => ({
  getRequestConfig: (cb: RequestConfigCallback) => {
    capturedGetRequestCb = cb;
    return {};
  },
}));

describe("i18n getRequestConfig callback", () => {
  const loadRequestModule = async () => {
    await import("../../../src/i18n/request");
    if (!capturedGetRequestCb) {
      throw new Error("getRequestConfig callback was not captured");
    }
  };

  beforeEach(async () => {
    capturedGetRequestCb = undefined;
    vi.resetModules();
  });

  it("loads EN messages and returns locale", async () => {
    await loadRequestModule();
    const result = await capturedGetRequestCb({
      requestLocale: Promise.resolve("en"),
    });
    const en = (await import("../../../src/messages/en.json")).default;
    expect(result.locale).toBe("en");
    expect(result.messages).toEqual(en);
  });

  it("loads DE messages and returns locale", async () => {
    await loadRequestModule();
    const result = await capturedGetRequestCb({
      requestLocale: Promise.resolve("de"),
    });
    const de = (await import("../../../src/messages/de.json")).default;
    expect(result.locale).toBe("de");
    expect(result.messages).toEqual(de);
  });

  it("falls back to default locale for invalid locale", async () => {
    await loadRequestModule();
    const result = await capturedGetRequestCb({
      requestLocale: Promise.resolve("fr"),
    });
    const en = (await import("../../../src/messages/en.json")).default;
    expect(result.locale).toBe("en");
    expect(result.messages).toEqual(en);
  });
});
