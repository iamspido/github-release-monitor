export type LocaleDirection = "ltr" | "rtl";
export type FontProfile =
  | "inter"
  | "noto"
  | "noto-arabic"
  | "noto-devanagari"
  | "noto-cjk-jp"
  | "noto-cjk-kr"
  | "noto-cjk-sc"
  | "noto-hebrew";

type LocaleRegistryEntry = {
  code: string;
  nativeName: string;
  direction: LocaleDirection;
  fontProfile: FontProfile;
};

export const localeRegistry = [
  {
    code: "en",
    nativeName: "English",
    direction: "ltr",
    fontProfile: "inter",
  },
  {
    code: "de",
    nativeName: "Deutsch",
    direction: "ltr",
    fontProfile: "inter",
  },
  {
    code: "fr",
    nativeName: "Français",
    direction: "ltr",
    fontProfile: "inter",
  },
  {
    code: "es",
    nativeName: "Español",
    direction: "ltr",
    fontProfile: "inter",
  },
  {
    code: "pt-BR",
    nativeName: "Português (Brasil)",
    direction: "ltr",
    fontProfile: "inter",
  },
  {
    code: "id",
    nativeName: "Bahasa Indonesia",
    direction: "ltr",
    fontProfile: "inter",
  },
  {
    code: "hi",
    nativeName: "हिन्दी",
    direction: "ltr",
    fontProfile: "noto-devanagari",
  },
  {
    code: "zh-CN",
    nativeName: "简体中文",
    direction: "ltr",
    fontProfile: "noto-cjk-sc",
  },
  {
    code: "ja",
    nativeName: "日本語",
    direction: "ltr",
    fontProfile: "noto-cjk-jp",
  },
  {
    code: "ko",
    nativeName: "한국어",
    direction: "ltr",
    fontProfile: "noto-cjk-kr",
  },
  {
    code: "tr",
    nativeName: "Türkçe",
    direction: "ltr",
    fontProfile: "noto",
  },
  {
    code: "vi",
    nativeName: "Tiếng Việt",
    direction: "ltr",
    fontProfile: "noto",
  },
  {
    code: "it",
    nativeName: "Italiano",
    direction: "ltr",
    fontProfile: "inter",
  },
  {
    code: "pl",
    nativeName: "Polski",
    direction: "ltr",
    fontProfile: "inter",
  },
  {
    code: "uk",
    nativeName: "Українська",
    direction: "ltr",
    fontProfile: "noto",
  },
  {
    code: "nl",
    nativeName: "Nederlands",
    direction: "ltr",
    fontProfile: "inter",
  },
  {
    code: "ru",
    nativeName: "Русский",
    direction: "ltr",
    fontProfile: "noto",
  },
  {
    code: "he",
    nativeName: "עברית",
    direction: "rtl",
    fontProfile: "noto-hebrew",
  },
  {
    code: "ar",
    nativeName: "العربية",
    direction: "rtl",
    fontProfile: "noto-arabic",
  },
] as const satisfies readonly LocaleRegistryEntry[];

export type Locale = (typeof localeRegistry)[number]["code"];
export type LocaleMetadata = {
  code: Locale;
  nativeName: string;
  direction: LocaleDirection;
  fontProfile: FontProfile;
};

export const locales: readonly Locale[] = localeRegistry.map(
  ({ code }) => code,
);
export const englishLocale = "en" satisfies Locale;
export const defaultLocale: Locale = englishLocale;

export const localeMetadata: readonly LocaleMetadata[] = localeRegistry;

const metadataByLocale = Object.fromEntries(
  localeRegistry.map((metadata) => [metadata.code, metadata]),
) as Record<Locale, LocaleMetadata>;

const canonicalLocaleByLowercase = new Map<string, Locale>(
  localeRegistry.map(({ code }) => [code.toLowerCase(), code]),
);

export function parseLocale(value: unknown): Locale | null {
  if (typeof value !== "string") return null;
  return canonicalLocaleByLowercase.get(value.trim().toLowerCase()) ?? null;
}

export function normalizeLocale(value: unknown): Locale {
  return parseLocale(value) ?? defaultLocale;
}

export function isSupportedLocale(value: unknown): value is Locale {
  return typeof value === "string" && parseLocale(value) === value;
}

export function getLocaleMetadata(locale: Locale): LocaleMetadata {
  return metadataByLocale[locale];
}
