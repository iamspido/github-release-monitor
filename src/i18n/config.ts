export type LocaleDirection = "ltr" | "rtl";
export type FontProfile = "inter" | "noto" | "noto-arabic" | "noto-hebrew";

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
