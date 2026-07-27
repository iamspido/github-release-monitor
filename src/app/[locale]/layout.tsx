import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";

import { AppClientInitializer } from "@/components/app-client-initializer";
import { LocaleDirectionProvider } from "@/components/locale-direction-provider";
import { Toaster } from "@/components/ui/toaster";
import { NetworkStatusProvider } from "@/hooks/use-network";
import { getLocaleMetadata, parseLocale } from "@/i18n/config";
import {
  getBodyFontVariableClassName,
  robotoVariableClassName,
} from "@/i18n/fonts";
import "../globals.css";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale: requestedLocale } = await params;
  const locale = parseLocale(requestedLocale);
  if (!locale) {
    notFound();
  }
  const t = await getTranslations({ locale, namespace: "Metadata" });

  return {
    title: t("title"),
    description: t("description"),
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale: requestedLocale } = await params;
  const locale = parseLocale(requestedLocale);
  // Validate that the incoming `locale` parameter is valid
  if (!locale) {
    notFound();
  }

  const messages = await getMessages();
  const { direction, fontProfile } = getLocaleMetadata(locale);

  return (
    <html
      lang={locale}
      dir={direction}
      data-font-profile={fontProfile}
      className={`${getBodyFontVariableClassName(fontProfile)} ${robotoVariableClassName} dark`}
    >
      <body className="font-body antialiased">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <LocaleDirectionProvider direction={direction}>
            <NetworkStatusProvider>
              <AppClientInitializer>
                {children}
                <Toaster />
              </AppClientInitializer>
            </NetworkStatusProvider>
          </LocaleDirectionProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
