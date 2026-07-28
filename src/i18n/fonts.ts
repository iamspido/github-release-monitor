import {
  Inter,
  Noto_Sans,
  Noto_Sans_Arabic,
  Noto_Sans_Hebrew,
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

const notoHebrew = Noto_Sans_Hebrew({
  display: "swap",
  variable: "--font-locale-body",
  subsets: ["hebrew"],
  preload: false,
});

const notoCjk = Noto_Sans_SC({
  display: "swap",
  variable: "--font-locale-body",
  preload: false,
});

const bodyFontVariableClassByProfile = {
  inter: inter.variable,
  noto: noto.variable,
  "noto-arabic": notoArabic.variable,
  "noto-cjk": notoCjk.variable,
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
