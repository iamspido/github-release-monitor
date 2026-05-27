import { revalidatePath } from "next/cache";
import { getLocale, getTranslations } from "next-intl/server";
import { sendTestAppriseNotification } from "@/lib/notifications";
import { sendTestEmail } from "@/lib/notifications/email";
import {
  getBasicAppriseTestBody,
  getComprehensiveMarkdownBody,
} from "@/lib/notifications/test-release-payloads";
import { checkForNewReleases } from "@/lib/releases/checker";
import { scheduleTask } from "@/lib/runtime/task-scheduler";
import {
  getRestrictedActionError,
  isRestrictedActionAllowed,
  log,
  updateReleaseCacheTags,
} from "@/lib/server-action-helpers";
import { getRepositories, saveRepositories } from "@/lib/storage/repositories";
import { getSettings } from "@/lib/storage/settings";
import type { AppriseStatus, GithubRelease, Repository } from "@/types";

const TEST_REPO_ID = "test/test";

export async function setupTestRepositoryAction(): Promise<{
  success: boolean;
  message: string;
}> {
  return scheduleTask("setupTestRepositoryAction", async () => {
    const locale = await getLocale();
    const t = await getTranslations({ locale, namespace: "TestPage" });
    if (!(await isRestrictedActionAllowed())) {
      return { success: false, message: await getRestrictedActionError() };
    }

    // Prepare a readable title/body so the card renders nicely before the first check
    const { title, body } = await getComprehensiveMarkdownBody(locale);

    try {
      const currentRepos = await getRepositories();
      const testRepoIndex = currentRepos.findIndex(
        (r) => r.id === TEST_REPO_ID,
      );

      if (testRepoIndex > -1) {
        currentRepos[testRepoIndex].lastSeenReleaseTag = "v0.9.0-reset";
        currentRepos[testRepoIndex].isNew = false;
        // Ensure a cached release exists so the UI shows a proper card immediately
        currentRepos[testRepoIndex].latestRelease = {
          html_url: `https://github.com/${TEST_REPO_ID}/releases/tag/v0.9.0-reset`,
          tag_name: "v0.9.0-reset",
          name: title,
          body: body,
          created_at: new Date().toISOString(),
          published_at: new Date().toISOString(),
          fetched_at: new Date().toISOString(),
        };
      } else {
        currentRepos.push({
          id: TEST_REPO_ID,
          url: `https://github.com/${TEST_REPO_ID}`,
          lastSeenReleaseTag: "v0.9.0-initial",
          isNew: false,
          latestRelease: {
            html_url: `https://github.com/${TEST_REPO_ID}/releases/tag/v0.9.0-initial`,
            tag_name: "v0.9.0-initial",
            name: title,
            body: body,
            created_at: new Date().toISOString(),
            published_at: new Date().toISOString(),
            fetched_at: new Date().toISOString(),
          },
        });
      }

      await saveRepositories(currentRepos);
      revalidatePath("/");
      revalidatePath("/test");
      updateReleaseCacheTags();
      return { success: true, message: t("toast_setup_test_repo_success") };
    } catch (error: unknown) {
      log.error("setupTestRepositoryAction failed:", error);
      return {
        success: false,
        message:
          error instanceof Error
            ? error.message || t("toast_setup_test_repo_error")
            : t("toast_setup_test_repo_error"),
      };
    }
  });
}

export async function triggerReleaseCheckAction(): Promise<{
  success: boolean;
  message: string;
}> {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: "TestPage" });
  if (!(await isRestrictedActionAllowed())) {
    return { success: false, message: await getRestrictedActionError() };
  }

  const {
    MAIL_HOST,
    MAIL_PORT,
    MAIL_FROM_ADDRESS,
    MAIL_TO_ADDRESS,
    APPRISE_URL,
  } = process.env;
  const isSmtpConfigured = !!(
    MAIL_HOST &&
    MAIL_PORT &&
    MAIL_FROM_ADDRESS &&
    MAIL_TO_ADDRESS
  );
  const isAppriseConfigured = !!APPRISE_URL;

  if (!isSmtpConfigured && !isAppriseConfigured) {
    return {
      success: false,
      message: t("toast_no_notification_service_configured"),
    };
  }

  try {
    const result = await checkForNewReleases({
      overrideLocale: locale,
      skipCache: true,
    });

    if (result && result.notificationsSent > 0) {
      return {
        success: true,
        message: t("toast_trigger_check_success_email_sent"),
      };
    } else {
      return {
        success: true,
        message: t("toast_trigger_check_success_no_email"),
      };
    }
  } catch (error: unknown) {
    log.error("triggerReleaseCheckAction failed:", error);
    return {
      success: false,
      message:
        error instanceof Error
          ? error.message || t("toast_trigger_check_error")
          : t("toast_trigger_check_error"),
    };
  }
}

export async function sendTestEmailAction(customEmail: string): Promise<{
  success: boolean;
  error?: string;
}> {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: "TestPage" });
  const tEmail = await getTranslations({ locale, namespace: "Email" });
  if (!(await isRestrictedActionAllowed())) {
    return { success: false, error: await getRestrictedActionError() };
  }

  const trimmedEmail = customEmail.trim();
  const recipient = trimmedEmail || process.env.MAIL_TO_ADDRESS;

  const { MAIL_HOST, MAIL_PORT, MAIL_FROM_ADDRESS } = process.env;
  if (!MAIL_HOST || !MAIL_PORT || !MAIL_FROM_ADDRESS || !recipient) {
    return {
      success: false,
      error: tEmail("error_config_incomplete"),
    };
  }

  if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
    return {
      success: false,
      error: t("invalid_email_format"),
    };
  }

  const testRepo: Repository = {
    id: "test/test",
    url: "https://github.com/test/test",
  };

  const { title, body } = await getComprehensiveMarkdownBody(locale);

  const testRelease: GithubRelease = {
    id: 12345,
    html_url: "https://github.com/test/test/releases/tag/v1.0.0",
    tag_name: "v1.0.0-test",
    name: title,
    body: body,
    created_at: new Date().toISOString(),
    published_at: new Date().toISOString(),
    prerelease: false,
    draft: false,
  };

  try {
    const settings = await getSettings();
    await sendTestEmail(
      testRepo,
      testRelease,
      locale,
      settings.timeFormat,
      recipient,
    );
    return { success: true };
  } catch (error: unknown) {
    log.error("sendTestEmailAction failed:", error);
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message || t("toast_email_error_description")
          : t("toast_email_error_description"),
    };
  }
}

export async function sendTestAppriseAction(): Promise<{
  success: boolean;
  error?: string;
}> {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: "TestPage" });
  if (!(await isRestrictedActionAllowed())) {
    return { success: false, error: await getRestrictedActionError() };
  }

  const { APPRISE_URL } = process.env;
  if (!APPRISE_URL) {
    log.warn("sendTestAppriseAction called but APPRISE_URL is not configured");
    return {
      success: false,
      error: t("toast_apprise_not_configured_error"),
    };
  }

  const testRepo: Repository = {
    id: "test/test",
    url: "https://github.com/test/test",
  };

  const { title, body } = await getBasicAppriseTestBody(locale);

  const testRelease: GithubRelease = {
    id: 12345,
    html_url: "https://github.com/test/test/releases/tag/v1.0.0",
    tag_name: "v1.0.0-test",
    name: title,
    body: body,
    created_at: new Date().toISOString(),
    published_at: new Date().toISOString(),
    prerelease: false,
    draft: false,
  };

  try {
    const settings = await getSettings();
    await sendTestAppriseNotification(testRepo, testRelease, locale, settings);
    return { success: true };
  } catch (error: unknown) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : String(error ?? "unknown"),
    };
  }
}

export async function checkAppriseStatusAction(): Promise<AppriseStatus> {
  if (!(await isRestrictedActionAllowed())) {
    return { status: "error", error: await getRestrictedActionError() };
  }

  const { APPRISE_URL } = process.env;
  if (!APPRISE_URL) {
    return { status: "not_configured" };
  }

  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: "TestPage" });

  try {
    const urlObject = new URL(APPRISE_URL);
    const statusUrl = `${urlObject.protocol}//${urlObject.host}/status`;

    const response = await fetch(statusUrl, {
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (response.ok) {
      return { status: "ok" };
    } else {
      return {
        status: "error",
        error: t("apprise_connection_error_status", {
          status: response.status,
        }),
      };
    }
  } catch {
    return {
      status: "error",
      error: t("apprise_connection_error_fetch"),
    };
  }
}

export async function refreshAndCheckAction(): Promise<{
  success: boolean;
  messageKey: "toast_refresh_success_description" | "toast_refresh_found_new";
}> {
  const locale = await getLocale();
  if (!(await isRestrictedActionAllowed())) {
    throw new Error(await getRestrictedActionError());
  }

  log.info("Manual refresh triggered by user");
  const result = await checkForNewReleases({
    overrideLocale: locale,
    skipCache: true,
  });

  const messageKey =
    result.notificationsSent > 0
      ? "toast_refresh_found_new"
      : "toast_refresh_success_description";

  log.info(
    `Manual refresh result: notificationsSent=${result.notificationsSent} checked=${result.checked}`,
  );
  return { success: true, messageKey };
}

export async function refreshDueRepositoriesAction(): Promise<{
  success: boolean;
  checked: number;
}> {
  if (!(await isRestrictedActionAllowed())) {
    throw new Error(await getRestrictedActionError());
  }

  const result = await checkForNewReleases({
    skipCache: true,
    onlyDue: true,
  });

  return { success: true, checked: result.checked };
}
