import type { Metadata } from "next";
import { Inter, Roboto } from "next/font/google";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";

import { AppClientInitializer } from "@/components/app-client-initializer";
import { Toaster } from "@/components/ui/toaster";
import { NetworkStatusProvider } from "@/hooks/use-network";
import { getLocaleMetadata, parseLocale } from "@/i18n/config";
import "../globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const roboto = Roboto({
  subsets: ["latin"],
  weight: ["500"],
  variable: "--font-roboto",
});

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
  const { direction } = getLocaleMetadata(locale);

  return (
    <html
      lang={locale}
      dir={direction}
      className={`${inter.variable} ${roboto.variable} dark`}
    >
      <body className="font-body antialiased">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <NetworkStatusProvider>
            <AppClientInitializer>
              {children}
              <Toaster />
            </AppClientInitializer>
          </NetworkStatusProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
