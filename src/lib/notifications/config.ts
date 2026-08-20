import type { Locale } from "@/i18n/config";
import {
  parseSmtpPort,
  parseSmtpTlsRejectUnauthorized,
} from "@/lib/smtp-config";

type NotificationEnv = Partial<NodeJS.ProcessEnv>;

function hasValue(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

export function getReleaseMonitorUrl(
  locale: Locale,
  env: NotificationEnv = process.env,
): string | undefined {
  const configuredUrl =
    env.BETTER_AUTH_URL?.trim() || env.BETTER_AUTH_BASE_URL?.trim();
  if (!configuredUrl) return undefined;

  try {
    const url = new URL(configuredUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return undefined;
    }
    return new URL(`/${encodeURIComponent(locale)}`, url.origin).href;
  } catch {
    return undefined;
  }
}

export function getNotificationRuntimeConfig(
  env: NotificationEnv = process.env,
) {
  const emailConfig = getEmailRuntimeConfig(env);

  return {
    hasMailHost: hasValue(env.MAIL_HOST),
    isSmtpConfigured: emailConfig.isComplete,
    isAppriseConfigured: hasValue(env.APPRISE_URL),
    appriseUrl: env.APPRISE_URL?.trim() || "",
    mailToAddress: env.MAIL_TO_ADDRESS?.trim() || "",
  };
}

export function getEmailRuntimeConfig(
  env: NotificationEnv = process.env,
  toAddress?: string,
) {
  const recipient = toAddress?.trim() || env.MAIL_TO_ADDRESS?.trim() || "";
  const port = parseSmtpPort(env.MAIL_PORT);

  return {
    host: env.MAIL_HOST?.trim() || "",
    port,
    username: env.MAIL_USERNAME?.trim() || undefined,
    password: env.MAIL_PASSWORD,
    fromAddress: env.MAIL_FROM_ADDRESS?.trim() || "",
    fromName: env.MAIL_FROM_NAME?.trim() || "",
    recipient,
    tlsRejectUnauthorized: parseSmtpTlsRejectUnauthorized(
      env.MAIL_TLS_REJECT_UNAUTHORIZED,
    ),
    isComplete:
      hasValue(env.MAIL_HOST) &&
      Number.isFinite(port) &&
      hasValue(env.MAIL_FROM_ADDRESS) &&
      Boolean(recipient),
  };
}
