import {
  Inter,
  Noto_Sans,
  Noto_Sans_Arabic,
  Noto_Sans_Devanagari,
  Noto_Sans_Hebrew,
  Noto_Sans_JP,
  Noto_Sans_KR,
  Noto_Sans_SC,
  Roboto,
} from "next/font/google";
import type { FontProfile } from "@/i18n/config";

const inter = Inter({
  display: "swap",
  variable: "--font-locale-body",
  subsets: ["latin"],
});

const noto = Noto_Sans({
  display: "swap",
  variable: "--font-locale-body",
  subsets: [
    "cyrillic",
    "cyrillic-ext",
    "greek",
    "greek-ext",
    "latin",
    "latin-ext",
    "vietnamese",
  ],
  preload: false,
});

const notoArabic = Noto_Sans_Arabic({
  display: "swap",
  variable: "--font-locale-body",
  subsets: ["arabic"],
  preload: false,
});

const notoDevanagari = Noto_Sans_Devanagari({
  display: "swap",
  variable: "--font-locale-body",
  subsets: ["devanagari"],
  preload: false,
});

const notoHebrew = Noto_Sans_Hebrew({
  display: "swap",
  variable: "--font-locale-body",
  subsets: ["hebrew"],
  preload: false,
});

const notoCjkSc = Noto_Sans_SC({
  display: "swap",
  variable: "--font-locale-body",
  preload: false,
});

const notoCjkJp = Noto_Sans_JP({
  display: "swap",
  variable: "--font-locale-body",
  preload: false,
});

const notoCjkKr = Noto_Sans_KR({
  display: "swap",
  variable: "--font-locale-body",
  preload: false,
});

const bodyFontVariableClassByProfile = {
  inter: inter.variable,
  noto: noto.variable,
  "noto-arabic": notoArabic.variable,
  "noto-devanagari": notoDevanagari.variable,
  "noto-cjk-jp": notoCjkJp.variable,
  "noto-cjk-kr": notoCjkKr.variable,
  "noto-cjk-sc": notoCjkSc.variable,
  "noto-hebrew": notoHebrew.variable,
} satisfies Record<FontProfile, string>;

const roboto = Roboto({
  subsets: ["latin"],
  weight: ["500"],
  display: "swap",
  variable: "--font-roboto",
});

export function getBodyFontVariableClassName(profile: FontProfile): string {
  return bodyFontVariableClassByProfile[profile];
}

export const robotoVariableClassName = roboto.variable;
