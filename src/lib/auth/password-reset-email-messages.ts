import type { Locale } from "@/i18n/config";

export interface PasswordResetEmailMessages {
  button: string;
  expiry_notice: string;
  ignore_notice: string;
  intro: string;
  subject: string;
  title: string;
}

type MessageCatalog = {
  PasswordResetEmail: PasswordResetEmailMessages;
};

export async function getPasswordResetEmailMessages(
  locale: Locale,
): Promise<PasswordResetEmailMessages> {
  const catalog = (await import(`../../messages/${locale}.json`))
    .default as MessageCatalog;
  return catalog.PasswordResetEmail;
}
