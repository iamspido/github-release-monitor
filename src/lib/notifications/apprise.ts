import { getTranslations } from "next-intl/server";
import {
  consumeResponseWithTimeout,
  discardResponseWithTimeout,
  fetchWithTimeout,
} from "@/lib/http/fetch-with-timeout";
import { logger } from "@/lib/logger";
import { getReleaseMonitorUrl } from "@/lib/notifications/config";
import {
  escapeMarkdownLinkDestination,
  escapeMarkdownText,
} from "@/lib/notifications/content-safety";
import {
  generateHtmlReleaseBody,
  generatePlainTextReleaseBody,
  generatePlainTextReleaseLinkLines,
  getFormattedDate,
} from "@/lib/notifications/email";
import type {
  AppriseFormat,
  GithubRelease,
  Locale,
  NotificationSettings,
  Repository,
} from "@/types";

function appendPriorityLinks(
  body: string,
  priorityLinks: readonly string[],
  maxChars: number,
  footerSeparator: string,
  truncatedText?: string,
): string {
  const allLinks = priorityLinks.join("\n");
  const fullBody = `${body}${footerSeparator}${allLinks}`;
  if (maxChars <= 0 || fullBody.length <= maxChars) return fullBody;

  let fittedLinks = "";
  for (const link of priorityLinks) {
    const candidate = fittedLinks ? `${fittedLinks}\n${link}` : link;
    if (candidate.length > maxChars) continue;
    fittedLinks = candidate;
  }

  if (!fittedLinks) return body.substring(0, maxChars);

  const footerCandidates = [
    truncatedText
      ? `${footerSeparator}${truncatedText}\n${fittedLinks}`
      : undefined,
    `${footerSeparator}${fittedLinks}`,
    `\n${fittedLinks}`,
    fittedLinks,
  ];
  const footer = footerCandidates.find(
    (candidate): candidate is string =>
      candidate !== undefined && candidate.length <= maxChars,
  );

  if (!footer) return body.substring(0, maxChars);
  return `${body.substring(0, maxChars - footer.length)}${footer}`;
}

async function generateMarkdownReleaseBody(
  release: GithubRelease,
  repository: Repository,
  locale: Locale,
  settings: NotificationSettings,
  maxChars: number,
): Promise<string> {
  const t = await getTranslations({ locale, namespace: "Email" });
  const tApprise = await getTranslations({ locale, namespace: "Apprise" });
  const { htmlDate } = await getFormattedDate(
    new Date(release.created_at),
    locale,
    settings.timeFormat,
  );

  const viewOnGithubText = tApprise("view_on_github_link", {
    link: escapeMarkdownLinkDestination(release.html_url),
  });
  const monitorUrl = getReleaseMonitorUrl(locale);
  const viewMonitorText = monitorUrl
    ? `[${escapeMarkdownText(t("view_monitor_label"))}](${escapeMarkdownLinkDestination(monitorUrl)})`
    : undefined;
  const priorityLinks = [viewOnGithubText, viewMonitorText].filter(
    (link): link is string => link !== undefined,
  );
  const truncatedText = tApprise("truncated_message");
  const footerSeparator = "\n\n---\n\n";

  const title = tApprise("title", {
    repoId: escapeMarkdownText(repository.id),
    tagName: escapeMarkdownText(release.tag_name),
  });
  const repoLink = `**[${escapeMarkdownText(repository.id)}](${escapeMarkdownLinkDestination(repository.url)})**`;
  const introText = t("text_new_version_of_markdown", { repoId: repoLink });

  const header = `
## ${title}

${introText}

* **${t("text_version_label")}**: ${escapeMarkdownText(release.tag_name)}
* **${t("text_release_name_label")}**: ${escapeMarkdownText(release.name || "N/A")}
* **${t("text_release_date_label")}**: ${escapeMarkdownText(htmlDate)}
`;

  let body = header.trim();
  if (settings.appriseIncludeReleaseNotes !== false) {
    body += `\n\n### ${t("text_release_notes_label")}\n---\n${release.body || t("text_no_notes")}`;
  }

  return appendPriorityLinks(
    body,
    priorityLinks,
    maxChars,
    footerSeparator,
    truncatedText,
  );
}

async function generateAppriseBody(
  release: GithubRelease,
  repository: Repository,
  format: AppriseFormat,
  locale: Locale,
  settings: NotificationSettings,
): Promise<string> {
  const maxChars = settings.appriseMaxCharacters ?? 0;
  const tApprise = await getTranslations({ locale, namespace: "Apprise" });

  switch (format) {
    case "html":
      return generateHtmlReleaseBody(
        release,
        repository,
        locale,
        settings.timeFormat,
        settings.appriseIncludeReleaseNotes !== false,
      );
    case "markdown":
      return generateMarkdownReleaseBody(
        release,
        repository,
        locale,
        settings,
        maxChars,
      );
    default: {
      const title = tApprise("title", {
        repoId: repository.id,
        tagName: release.tag_name,
      });
      const plainTextBody = await generatePlainTextReleaseBody(
        release,
        repository,
        locale,
        settings.timeFormat,
        settings.appriseIncludeReleaseNotes !== false,
        false,
      );
      const priorityLinks = await generatePlainTextReleaseLinkLines(
        release,
        locale,
      );
      const contentBody = `${title}\n\n${plainTextBody.trim()}`;
      return appendPriorityLinks(contentBody, priorityLinks, maxChars, "\n\n");
    }
  }
}

export async function sendAppriseNotification(
  repository: Repository,
  release: GithubRelease,
  locale: Locale,
  settings: NotificationSettings,
) {
  const { APPRISE_URL } = process.env;
  if (!APPRISE_URL) return;

  const t = await getTranslations({ locale, namespace: "Apprise" });

  const tags = repository.appriseTags ?? settings.appriseTags;
  const format = repository.appriseFormat ?? settings.appriseFormat ?? "text";

  const title = t("title", {
    repoId: repository.id,
    tagName: release.tag_name,
  });
  const body = await generateAppriseBody(
    release,
    repository,
    format,
    locale,
    settings,
  );

  const payload: {
    title: string;
    body: string;
    format: AppriseFormat;
    tag?: string;
  } = {
    title,
    body,
    format,
  };

  if (tags) {
    payload.tag = tags;
  }

  try {
    const normalizedAppriseUrl = APPRISE_URL.replace(/\/+$/, "");
    const notifyUrl = /\/notify(\/|$)/.test(normalizedAppriseUrl)
      ? normalizedAppriseUrl
      : `${normalizedAppriseUrl}/notify`;

    const response = await fetchWithTimeout(notifyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorBody = await consumeResponseWithTimeout(response, (result) =>
        result.text(),
      );
      logger
        .withScope("Notifications")
        .error(
          `Apprise notification for ${repository.id} failed with status ${response.status}: ${errorBody}`,
        );
      throw new Error(
        t("error_send_failed_detailed", {
          status: response.status,
          details: errorBody,
        }),
      );
    }
    await discardResponseWithTimeout(response);

    logger
      .withScope("Notifications")
      .info(
        `Apprise notification sent successfully for ${repository.id} ${release.tag_name}`,
      );
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : String(error ?? "unknown");
    logger
      .withScope("Notifications")
      .error(
        `Failed to send Apprise notification for ${repository.id}. Please check if the service is running and the URL is correct. Error: ${message}`,
        error instanceof Error ? error : undefined,
      );
    throw error instanceof Error ? error : new Error(message);
  }
}

export async function sendTestAppriseNotification(
  repository: Repository,
  release: GithubRelease,
  locale: Locale,
  settings: NotificationSettings,
) {
  const t = await getTranslations({ locale, namespace: "Apprise" });
  const { APPRISE_URL } = process.env;
  if (!APPRISE_URL) {
    throw new Error(t("error_not_configured"));
  }
  const testSettings = { ...settings, appriseFormat: "text" as AppriseFormat };
  const testRepo = { ...repository, appriseFormat: "text" as AppriseFormat };
  await sendAppriseNotification(testRepo, release, locale, testSettings);
}
