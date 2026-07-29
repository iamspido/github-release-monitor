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
    return capturedGetRequestCb;
  };

  beforeEach(async () => {
    capturedGetRequestCb = undefined;
    vi.resetModules();
  });

  it("loads EN messages and returns locale", async () => {
    const getRequestConfig = await loadRequestModule();
    const result = await getRequestConfig({
      requestLocale: Promise.resolve("en"),
    });
    const en = (await import("../../../src/messages/en.json")).default;
    expect(result.locale).toBe("en");
    expect(result.messages).toEqual(en);
  });

  it("loads DE messages and returns locale", async () => {
    const getRequestConfig = await loadRequestModule();
    const result = await getRequestConfig({
      requestLocale: Promise.resolve("de"),
    });
    const de = (await import("../../../src/messages/de.json")).default;
    expect(result.locale).toBe("de");
    expect(result.messages).toEqual(de);
  });

  it("loads AR messages and returns the canonical locale", async () => {
    const getRequestConfig = await loadRequestModule();
    const result = await getRequestConfig({
      requestLocale: Promise.resolve("AR"),
    });
    const ar = (await import("../../../src/messages/ar.json")).default;
    expect(result.locale).toBe("ar");
    expect(result.messages).toEqual(ar);
  });

  it("loads FR messages and returns the canonical locale", async () => {
    const getRequestConfig = await loadRequestModule();
    const result = await getRequestConfig({
      requestLocale: Promise.resolve("FR"),
    });
    const fr = (await import("../../../src/messages/fr.json")).default;
    expect(result.locale).toBe("fr");
    expect(result.messages).toEqual(fr);
  });

  it("loads ES messages and returns the canonical locale", async () => {
    const getRequestConfig = await loadRequestModule();
    const result = await getRequestConfig({
      requestLocale: Promise.resolve("ES"),
    });
    const es = (await import("../../../src/messages/es.json")).default;
    expect(result.locale).toBe("es");
    expect(result.messages).toEqual(es);
  });

  it("loads PT-BR messages and returns the canonical locale", async () => {
    const getRequestConfig = await loadRequestModule();
    const result = await getRequestConfig({
      requestLocale: Promise.resolve("pt-br"),
    });
    const ptBR = (await import("../../../src/messages/pt-BR.json")).default;
    expect(result.locale).toBe("pt-BR");
    expect(result.messages).toEqual(ptBR);
  });

  it("loads Indonesian messages", async () => {
    const getRequestConfig = await loadRequestModule();
    const result = await getRequestConfig({
      requestLocale: Promise.resolve("ID"),
    });
    const indonesian = (await import("../../../src/messages/id.json")).default;
    expect(result.locale).toBe("id");
    expect(result.messages).toEqual(indonesian);
  });

  it("loads Hindi messages", async () => {
    const getRequestConfig = await loadRequestModule();
    const result = await getRequestConfig({
      requestLocale: Promise.resolve("HI"),
    });
    const hindi = (await import("../../../src/messages/hi.json")).default;
    expect(result.locale).toBe("hi");
    expect(result.messages).toEqual(hindi);
  });

  it("loads ZH-CN messages and returns the canonical locale", async () => {
    const getRequestConfig = await loadRequestModule();
    const result = await getRequestConfig({
      requestLocale: Promise.resolve("zh-cn"),
    });
    const zhCN = (await import("../../../src/messages/zh-CN.json")).default;
    expect(result.locale).toBe("zh-CN");
    expect(result.messages).toEqual(zhCN);
  });

  it("loads Japanese messages", async () => {
    const getRequestConfig = await loadRequestModule();
    const result = await getRequestConfig({
      requestLocale: Promise.resolve("JA"),
    });
    const japanese = (await import("../../../src/messages/ja.json")).default;
    expect(result.locale).toBe("ja");
    expect(result.messages).toEqual(japanese);
  });

  it("loads Korean messages", async () => {
    const getRequestConfig = await loadRequestModule();
    const result = await getRequestConfig({
      requestLocale: Promise.resolve("KO"),
    });
    const korean = (await import("../../../src/messages/ko.json")).default;
    expect(result.locale).toBe("ko");
    expect(result.messages).toEqual(korean);
  });

  it("loads Turkish messages", async () => {
    const getRequestConfig = await loadRequestModule();
    const result = await getRequestConfig({
      requestLocale: Promise.resolve("TR"),
    });
    const turkish = (await import("../../../src/messages/tr.json")).default;
    expect(result.locale).toBe("tr");
    expect(result.messages).toEqual(turkish);
  });

  it("loads Vietnamese messages", async () => {
    const getRequestConfig = await loadRequestModule();
    const result = await getRequestConfig({
      requestLocale: Promise.resolve("VI"),
    });
    const vietnamese = (await import("../../../src/messages/vi.json")).default;
    expect(result.locale).toBe("vi");
    expect(result.messages).toEqual(vietnamese);
  });

  it("loads Italian messages", async () => {
    const getRequestConfig = await loadRequestModule();
    const result = await getRequestConfig({
      requestLocale: Promise.resolve("IT"),
    });
    const italian = (await import("../../../src/messages/it.json")).default;
    expect(result.locale).toBe("it");
    expect(result.messages).toEqual(italian);
  });

  it("loads Polish messages", async () => {
    const getRequestConfig = await loadRequestModule();
    const result = await getRequestConfig({
      requestLocale: Promise.resolve("PL"),
    });
    const polish = (await import("../../../src/messages/pl.json")).default;
    expect(result.locale).toBe("pl");
    expect(result.messages).toEqual(polish);
  });

  it("loads Ukrainian messages", async () => {
    const getRequestConfig = await loadRequestModule();
    const result = await getRequestConfig({
      requestLocale: Promise.resolve("UK"),
    });
    const ukrainian = (await import("../../../src/messages/uk.json")).default;
    expect(result.locale).toBe("uk");
    expect(result.messages).toEqual(ukrainian);
  });

  it("loads Dutch messages", async () => {
    const getRequestConfig = await loadRequestModule();
    const result = await getRequestConfig({
      requestLocale: Promise.resolve("NL"),
    });
    const dutch = (await import("../../../src/messages/nl.json")).default;
    expect(result.locale).toBe("nl");
    expect(result.messages).toEqual(dutch);
  });

  it("loads Russian messages", async () => {
    const getRequestConfig = await loadRequestModule();
    const result = await getRequestConfig({
      requestLocale: Promise.resolve("RU"),
    });
    const russian = (await import("../../../src/messages/ru.json")).default;
    expect(result.locale).toBe("ru");
    expect(result.messages).toEqual(russian);
  });

  it("loads Hebrew messages", async () => {
    const getRequestConfig = await loadRequestModule();
    const result = await getRequestConfig({
      requestLocale: Promise.resolve("HE"),
    });
    const hebrew = (await import("../../../src/messages/he.json")).default;
    expect(result.locale).toBe("he");
    expect(result.messages).toEqual(hebrew);
  });

  it("falls back to default locale for invalid locale", async () => {
    const getRequestConfig = await loadRequestModule();
    const result = await getRequestConfig({
      requestLocale: Promise.resolve("invalid_locale"),
    });
    const en = (await import("../../../src/messages/en.json")).default;
    expect(result.locale).toBe("en");
    expect(result.messages).toEqual(en);
  });
});
