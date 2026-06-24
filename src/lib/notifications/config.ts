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
