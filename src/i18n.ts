import {getRequestConfig} from 'next-intl/server';
import { notFound } from 'next/navigation';
import { locales, defaultLocale, pathnames } from './i18n-config';


export default getRequestConfig(async ({requestLocale}) => {
  // This typically corresponds to the `[locale]` segment
  const locale = await requestLocale;

  // Validate that the incoming `locale` parameter is valid
  if (!locales.includes(locale as any)) notFound();

  return {
    messages: (await import(`./messages/${locale}.json`)).default,
    locale,
  };
});
