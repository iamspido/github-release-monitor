import { getLocale, getTranslations } from "next-intl/server";
import { canPerformRestrictedAction } from "@/lib/auth/access";
import { logger } from "@/lib/logger";

const logAuth = logger.withScope("Auth");

type RestrictedActionFallback<TResult> =
  | TResult
  | (() => TResult | Promise<TResult>);

export async function getRestrictedActionError(): Promise<string> {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: "Actions" });
  return t("error_auth_required");
}

async function isExposedRestrictedActionAllowed(): Promise<boolean> {
  const allowed = await canPerformRestrictedAction();
  if (!allowed) {
    logAuth.warn(
      "Rejected an exposed restricted action because the request is unauthenticated.",
    );
  }
  return allowed;
}

export async function runExposedRestrictedActionWithFallback<TResult>(
  action: () => Promise<TResult>,
  fallback: RestrictedActionFallback<TResult>,
): Promise<TResult> {
  if (!(await isExposedRestrictedActionAllowed())) {
    return typeof fallback === "function"
      ? (fallback as () => TResult | Promise<TResult>)()
      : fallback;
  }

  return action();
}

export async function runExposedRestrictedActionOrThrow<TResult>(
  action: () => Promise<TResult>,
): Promise<TResult> {
  if (!(await isExposedRestrictedActionAllowed())) {
    throw new Error(await getRestrictedActionError());
  }

  return action();
}
