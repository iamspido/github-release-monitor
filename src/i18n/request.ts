import { getRequestConfig } from "next-intl/server";
import { defaultLocale, parseLocale } from "./config";

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = parseLocale(requested) ?? defaultLocale;

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
