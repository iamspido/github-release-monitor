import { updateTag } from "next/cache";
import { getLocale, getTranslations } from "next-intl/server";
import { canPerformRestrictedAction } from "@/lib/auth/access";
import { logger } from "@/lib/logger";

export const log = logger.withScope("WebServer");

export function normalizeEnvToken(value?: string): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  const isWrappedInQuotes =
    (first === '"' && last === '"') || (first === "'" && last === "'");
  const raw = isWrappedInQuotes ? trimmed.slice(1, -1).trim() : trimmed;
  if (!raw) return null;

  // Defensive: some env providers may inject newlines/whitespace into tokens.
  // Token formats are typically alphanumeric and do not include whitespace.
  return raw.replace(/\s+/g, "");
}

export function updateReleaseCacheTags(): void {
  updateTag("github-releases");
  updateTag("codeberg-releases");
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
