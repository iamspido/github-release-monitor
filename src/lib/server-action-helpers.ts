import { updateTag } from "next/cache";
import { getLocale, getTranslations } from "next-intl/server";
import { canPerformRestrictedAction } from "@/lib/auth/access";
import { logger } from "@/lib/logger";
import { normalizeAccessTokenEnvValue } from "@/lib/secret-env";

export const log = logger.withScope("WebServer");

export function normalizeEnvToken(value?: string): string | null {
  return normalizeAccessTokenEnvValue(value);
}

export function updateReleaseCacheTags(): void {
  updateTag("github-releases");
  updateTag("codeberg-releases");
  updateTag("forgejo-releases");
  updateTag("gitlab-releases");
}

export async function getRestrictedActionError(): Promise<string> {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: "Actions" });
  return t("error_auth_required");
}

export async function isRestrictedActionAllowed(): Promise<boolean> {
  const allowed = await canPerformRestrictedAction();
  if (!allowed) {
    log.warn(
      "Rejected restricted action because the request is unauthenticated.",
    );
  }
  return allowed;
}
