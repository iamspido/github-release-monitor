import { createTranslator } from "next-intl";
import deMessages from "@/messages/de.json";
import enMessages from "@/messages/en.json";

describe("notification digest messages", () => {
  it("formats localized singular and plural email subjects", () => {
    const translateEnglish = createTranslator({
      locale: "en",
      messages: enMessages,
      namespace: "Email",
    });
    const translateGerman = createTranslator({
      locale: "de",
      messages: deMessages,
      namespace: "Email",
    });

    expect(translateEnglish("digest_subject", { count: 1 })).toBe(
      "1 new release available",
    );
    expect(translateEnglish("digest_subject", { count: 8 })).toBe(
      "8 new releases available",
    );
    expect(translateGerman("digest_subject", { count: 1 })).toBe(
      "1 neues Release verfügbar",
    );
    expect(translateGerman("digest_subject", { count: 8 })).toBe(
      "8 neue Releases verfügbar",
    );
  });

  it("formats localized singular and plural Apprise omission notices", () => {
    const translateEnglish = createTranslator({
      locale: "en",
      messages: enMessages,
      namespace: "Apprise",
    });
    const translateGerman = createTranslator({
      locale: "de",
      messages: deMessages,
      namespace: "Apprise",
    });

    expect(translateEnglish("digest_omitted", { count: 1 })).toBe(
      "1 additional release was omitted because of the character limit.",
    );
    expect(translateEnglish("digest_omitted", { count: 3 })).toBe(
      "3 additional releases were omitted because of the character limit.",
    );
    expect(translateGerman("digest_omitted", { count: 1 })).toBe(
      "1 weiteres Release wurde wegen des Zeichenlimits ausgelassen.",
    );
    expect(translateGerman("digest_omitted", { count: 3 })).toBe(
      "3 weitere Releases wurden wegen des Zeichenlimits ausgelassen.",
    );
  });
});
