type NotificationEnv = Partial<NodeJS.ProcessEnv>;

function hasValue(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

export function getNotificationRuntimeConfig(
  env: NotificationEnv = process.env,
) {
  return {
    hasMailHost: hasValue(env.MAIL_HOST),
    isSmtpConfigured:
      hasValue(env.MAIL_HOST) &&
      hasValue(env.MAIL_PORT) &&
      hasValue(env.MAIL_FROM_ADDRESS) &&
      hasValue(env.MAIL_TO_ADDRESS),
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
  const port = Number.parseInt(env.MAIL_PORT ?? "", 10);

  return {
    host: env.MAIL_HOST?.trim() || "",
    port,
    username: env.MAIL_USERNAME?.trim() || undefined,
    password: env.MAIL_PASSWORD,
    fromAddress: env.MAIL_FROM_ADDRESS?.trim() || "",
    fromName: env.MAIL_FROM_NAME?.trim() || "",
    recipient,
    isComplete:
      hasValue(env.MAIL_HOST) &&
      Number.isFinite(port) &&
      hasValue(env.MAIL_FROM_ADDRESS) &&
      Boolean(recipient),
  };
}
