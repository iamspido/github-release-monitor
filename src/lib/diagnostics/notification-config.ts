import { getAuthenticationMethod } from "@/lib/auth/mode";
import { getNotificationRuntimeConfig } from "@/lib/notifications/config";
import type { NotificationConfig } from "@/types";

const MASKED_VALUE = "••••••••";
const HIDDEN_SEGMENT = "<hidden>";

function hasValue(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

export function sanitizeDiagnosticUrl(
  value: string | undefined,
): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    url.username = url.username ? HIDDEN_SEGMENT : "";
    url.password = url.password ? HIDDEN_SEGMENT : "";
    url.hash = url.hash ? "#hidden" : "";

    const pathSegments = url.pathname.split("/");
    const notifyIndex = pathSegments.indexOf("notify");
    if (notifyIndex !== -1 && pathSegments.length > notifyIndex + 1) {
      for (let i = notifyIndex + 1; i < pathSegments.length; i += 1) {
        if (pathSegments[i]) {
          pathSegments[i] = HIDDEN_SEGMENT;
        }
      }
      url.pathname = pathSegments.join("/");
    }

    for (const key of Array.from(url.searchParams.keys())) {
      url.searchParams.set(key, HIDDEN_SEGMENT);
    }

    return url.toString().replaceAll("%3Chidden%3E", HIDDEN_SEGMENT);
  } catch {
    return trimmed;
  }
}

export function buildNotificationConfig(
  env: Partial<NodeJS.ProcessEnv> = process.env,
): NotificationConfig {
  const { isSmtpConfigured, isAppriseConfigured } =
    getNotificationRuntimeConfig(env);
  const authenticationMethod = getAuthenticationMethod(env);
  const mailPasswordSet = hasValue(env.MAIL_PASSWORD);
  const mailPasswordRevealMode = mailPasswordSet
    ? authenticationMethod === "External"
      ? "external_click"
      : "password_confirm"
    : "none";
  const appriseUrlSet = hasValue(env.APPRISE_URL);
  const sanitizedAppriseUrl = sanitizeDiagnosticUrl(env.APPRISE_URL);
  const appriseUrlHasHiddenParts =
    appriseUrlSet && sanitizedAppriseUrl !== env.APPRISE_URL?.trim();
  const appriseUrlRevealMode = appriseUrlHasHiddenParts
    ? authenticationMethod === "External"
      ? "external_click"
      : "password_confirm"
    : "none";

  return {
    isSmtpConfigured,
    isAppriseConfigured,
    variables: [
      {
        key: "MAIL_HOST",
        displayValue: env.MAIL_HOST || null,
        isSet: hasValue(env.MAIL_HOST),
        isRequired: true,
        isSensitive: false,
        revealMode: "none",
      },
      {
        key: "MAIL_PORT",
        displayValue: env.MAIL_PORT || null,
        isSet: hasValue(env.MAIL_PORT),
        isRequired: true,
        isSensitive: false,
        revealMode: "none",
      },
      {
        key: "MAIL_USERNAME",
        displayValue: env.MAIL_USERNAME || null,
        isSet: hasValue(env.MAIL_USERNAME),
        isRequired: false,
        isSensitive: false,
        revealMode: "none",
      },
      {
        key: "MAIL_PASSWORD",
        displayValue: mailPasswordSet ? MASKED_VALUE : null,
        isSet: mailPasswordSet,
        isRequired: false,
        isSensitive: true,
        revealMode: mailPasswordRevealMode,
      },
      {
        key: "MAIL_FROM_ADDRESS",
        displayValue: env.MAIL_FROM_ADDRESS || null,
        isSet: hasValue(env.MAIL_FROM_ADDRESS),
        isRequired: true,
        isSensitive: false,
        revealMode: "none",
      },
      {
        key: "MAIL_FROM_NAME",
        displayValue: env.MAIL_FROM_NAME || null,
        isSet: hasValue(env.MAIL_FROM_NAME),
        isRequired: false,
        isSensitive: false,
        revealMode: "none",
      },
      {
        key: "MAIL_TO_ADDRESS",
        displayValue: env.MAIL_TO_ADDRESS || null,
        isSet: hasValue(env.MAIL_TO_ADDRESS),
        isRequired: true,
        isSensitive: false,
        revealMode: "none",
      },
      {
        key: "APPRISE_URL",
        displayValue: sanitizedAppriseUrl,
        isSet: appriseUrlSet,
        isRequired: false,
        isSensitive: true,
        revealMode: appriseUrlRevealMode,
      },
    ],
  };
}

export {
  beginSecretRevealStepUpActionImpl,
  completeSecretRevealStepUpActionImpl,
  getSecretRevealOptionsActionImpl,
  type RevealAppriseUrlResult,
  type RevealMailPasswordResult,
  revealAppriseUrlActionImpl,
  revealMailPasswordActionImpl,
  type SecretRevealOptionsResult,
  type SecretRevealStepUpResult,
  verifySecretRevealTotpActionImpl,
} from "@/lib/diagnostics/secret-reveal-service";
