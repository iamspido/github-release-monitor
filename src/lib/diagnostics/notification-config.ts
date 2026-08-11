import { getAuthenticationMethod } from "@/lib/auth/mode";
import { getNotificationRuntimeConfig } from "@/lib/notifications/config";
import type { NotificationConfig } from "@/types";

const MASKED_VALUE = "••••••••";
const HIDDEN_SEGMENT = "<hidden>";

type NotificationVariableKey =
  | "MAIL_HOST"
  | "MAIL_PORT"
  | "MAIL_USERNAME"
  | "MAIL_PASSWORD"
  | "MAIL_FROM_ADDRESS"
  | "MAIL_FROM_NAME"
  | "MAIL_TO_ADDRESS"
  | "MAIL_TLS_REJECT_UNAUTHORIZED"
  | "APPRISE_URL";

type NotificationVariableSpec = {
  key: NotificationVariableKey;
  isRequired: boolean;
  isSensitive?: boolean;
};

const NOTIFICATION_VARIABLE_SPECS: readonly NotificationVariableSpec[] = [
  { key: "MAIL_HOST", isRequired: true },
  { key: "MAIL_PORT", isRequired: true },
  { key: "MAIL_USERNAME", isRequired: false },
  { key: "MAIL_PASSWORD", isRequired: false, isSensitive: true },
  { key: "MAIL_FROM_ADDRESS", isRequired: true },
  { key: "MAIL_FROM_NAME", isRequired: false },
  { key: "MAIL_TO_ADDRESS", isRequired: true },
  { key: "MAIL_TLS_REJECT_UNAUTHORIZED", isRequired: false },
  { key: "APPRISE_URL", isRequired: false, isSensitive: true },
];

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

  const displayOverrides: Partial<
    Record<NotificationVariableKey, string | null>
  > = {
    MAIL_PASSWORD: mailPasswordSet ? MASKED_VALUE : null,
    APPRISE_URL: sanitizedAppriseUrl,
  };
  const revealModes: Partial<
    Record<
      NotificationVariableKey,
      "none" | "external_click" | "password_confirm"
    >
  > = {
    MAIL_PASSWORD: mailPasswordRevealMode,
    APPRISE_URL: appriseUrlRevealMode,
  };

  return {
    isSmtpConfigured,
    isAppriseConfigured,
    variables: NOTIFICATION_VARIABLE_SPECS.map((spec) => ({
      key: spec.key,
      displayValue:
        spec.key in displayOverrides
          ? (displayOverrides[spec.key] ?? null)
          : env[spec.key] || null,
      isSet: hasValue(env[spec.key]),
      isRequired: spec.isRequired,
      isSensitive: spec.isSensitive ?? false,
      revealMode: revealModes[spec.key] ?? "none",
    })),
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
