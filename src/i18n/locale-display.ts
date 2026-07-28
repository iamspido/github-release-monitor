import {
  englishLocale,
  getLocaleMetadata,
  type LocaleMetadata,
  localeMetadata,
} from "@/i18n/config";

const localeDisplayNameCollator = new Intl.Collator(englishLocale, {
  sensitivity: "base",
  usage: "sort",
});

function compareLocaleDisplayNames(
  left: LocaleMetadata,
  right: LocaleMetadata,
): number {
  const nameOrder = localeDisplayNameCollator.compare(
    left.nativeName,
    right.nativeName,
  );
  if (nameOrder !== 0) return nameOrder;
  return left.code < right.code ? -1 : left.code > right.code ? 1 : 0;
}

export const localeDisplayMetadata: readonly LocaleMetadata[] = [
  getLocaleMetadata(englishLocale),
  ...localeMetadata
    .filter(({ code }) => code !== englishLocale)
    .sort(compareLocaleDisplayNames),
];
