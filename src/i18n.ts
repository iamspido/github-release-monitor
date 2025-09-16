import {getRequestConfig} from 'next-intl/server';
import { notFound } from 'next/navigation';
import { locales, defaultLocale, pathnames } from './i18n-config';


export default getRequestConfig(async ({requestLocale}) => {
  // This typically corresponds to the `[locale]` segment
  const requested = await requestLocale;

  // Validate that the incoming `locale` parameter is valid
  if (!requested || !locales.includes(requested as any)) notFound();

  const locale = requested;

  return {
    messages: (await import(`./messages/${locale}.json`)).default,
    locale,
  };
});
