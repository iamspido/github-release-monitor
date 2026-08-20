import { getTranslations } from "next-intl/server";
import { remark } from "remark";
import remarkGfm from "remark-gfm";
import remarkHtml from "remark-html";
import { getLocaleMetadata, type Locale } from "@/i18n/config";
import { isolateAutoText, isolateLtrText } from "@/lib/bidi";
import { formatAbsoluteDateTime } from "@/lib/date-time";
import { logger } from "@/lib/logger";
import {
  getEmailRuntimeConfig,
  getReleaseMonitorUrl,
} from "@/lib/notifications/config";
import {
  escapeHtml,
  escapeHtmlAttribute,
  safeExternalUrl,
} from "@/lib/notifications/content-safety";
import { renderReleaseEmailHtml } from "@/lib/notifications/email-html-template";
import { sendEmailMessage } from "@/lib/notifications/email-transport";
import { getServerTimeZone } from "@/lib/server-time-zone";
import type { GithubRelease, Repository, TimeFormat } from "@/types";

export async function getFormattedDate(
  date: Date,
  locale: Locale,
  timeFormat: TimeFormat,
): Promise<{ textDate: string; htmlDate: string }> {
  const timeZone = getServerTimeZone();
  const commonFormat: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "numeric",
    timeZoneName: "short",
  };
  const textDate = formatAbsoluteDateTime(date, {
    locale,
    timeFormat,
    timeZone,
    format: commonFormat,
  });
  const htmlDate = formatAbsoluteDateTime(date, {
    locale,
    timeFormat,
    timeZone,
    format: {
      ...commonFormat,
      weekday: "long",
    },
  });

  return { textDate, htmlDate };
}

export async function generatePlainTextReleaseBody(
  release: GithubRelease,
  repository: Repository,
  locale: Locale,
  timeFormat: TimeFormat,
  includeReleaseNotes = true,
  includeLinks = true,
): Promise<string> {
  const t = await getTranslations({ locale, namespace: "Email" });
  const { htmlDate } = await getFormattedDate(
    new Date(release.created_at),
    locale,
    timeFormat,
  );
  const releaseName = release.name || "N/A";
  const links = includeLinks
    ? await generatePlainTextReleaseLinks(release, locale)
    : "";

  return `
${t("text_new_version_of", { repoId: isolateLtrText(repository.id) })}

${t("text_version_label")}: ${isolateLtrText(release.tag_name)}
${t("text_release_name_label")}: ${isolateAutoText(releaseName)}
${t("text_release_date_label")}: ${isolateAutoText(htmlDate)}

${
  includeReleaseNotes
    ? `${t("text_release_notes_label")}:
${release.body ? isolateAutoText(release.body) : t("text_no_notes")}

`
    : ""
}${links ? `\n${links}` : ""}
`;
}

export async function generatePlainTextReleaseLinks(
  release: GithubRelease,
  locale: Locale,
): Promise<string> {
  return (await generatePlainTextReleaseLinkLines(release, locale)).join("\n");
}

export async function generatePlainTextReleaseLinkLines(
  release: GithubRelease,
  locale: Locale,
): Promise<string[]> {
  const t = await getTranslations({ locale, namespace: "Email" });
  const monitorUrl = getReleaseMonitorUrl(locale);
  return [
    `${t("text_view_on_github_label")}: ${isolateLtrText(release.html_url)}`,
    monitorUrl
      ? `${t("view_monitor_label")}: ${isolateLtrText(monitorUrl)}`
      : undefined,
  ].filter((line): line is string => line !== undefined);
}

export async function generateHtmlReleaseBody(
  release: GithubRelease,
  repository: Repository,
  locale: Locale,
  timeFormat: TimeFormat,
  includeReleaseNotes = true,
): Promise<string> {
  const t = await getTranslations({ locale, namespace: "Email" });
  const subject = t("subject", {
    repoId: isolateLtrText(repository.id),
    tagName: isolateLtrText(release.tag_name),
  });
  const subjectHtml = escapeHtml(subject);
  const { htmlDate } = await getFormattedDate(
    new Date(release.created_at),
    locale,
    timeFormat,
  );
  const safeLocale = escapeHtmlAttribute(locale);
  const safeDirection = escapeHtmlAttribute(
    getLocaleMetadata(locale).direction,
  );
  const safeRepoId = escapeHtml(repository.id);
  const safeRepoUrl = escapeHtmlAttribute(safeExternalUrl(repository.url));
  const safeReleaseTagName = escapeHtml(release.tag_name);
  const safeReleaseName = escapeHtml(release.name || "N/A");
  const safeReleaseUrl = escapeHtmlAttribute(safeExternalUrl(release.html_url));
  const monitorUrl = getReleaseMonitorUrl(locale);
  const safeMonitorUrl = monitorUrl
    ? escapeHtmlAttribute(safeExternalUrl(monitorUrl))
    : undefined;
  const safeHtmlDate = escapeHtml(htmlDate);

  const releaseBodyHtml = includeReleaseNotes
    ? release.body
      ? String(
          await remark()
            .use(remarkGfm)
            .use(remarkHtml, { sanitize: true })
            .process(release.body),
        )
      : `<p style="font-style: italic;">${escapeHtml(t("html_no_notes"))}</p>`
    : undefined;

  const repoLink = `<a href="${safeRepoUrl}" style="color: #8c9fe8; text-decoration: none;"><strong style="color: #fafafa;"><bdi dir="ltr" style="direction: ltr; unicode-bidi: isolate;">${safeRepoId}</bdi></strong></a>`;
  const introHtml = t("html_intro", {
    repoId: "REPO_PLACEHOLDER",
  }).replaceAll("REPO_PLACEHOLDER", () => repoLink);
  const titleRepoHtml = `<bdi dir="ltr" class="technical-value" style="direction: ltr; unicode-bidi: isolate;">${safeRepoId}</bdi>`;
  const titleTagHtml = `<bdi dir="ltr" class="technical-value" style="direction: ltr; unicode-bidi: isolate;">${safeReleaseTagName}</bdi>`;
  const titleHtml = escapeHtml(
    t("html_title", {
      repoId: "TITLE_REPO_PLACEHOLDER",
      tagName: "TITLE_TAG_PLACEHOLDER",
    }),
  )
    .replaceAll("TITLE_REPO_PLACEHOLDER", () => titleRepoHtml)
    .replaceAll("TITLE_TAG_PLACEHOLDER", () => titleTagHtml);

  return renderReleaseEmailHtml({
    buttonTextHtml: escapeHtml(t("html_button_text")),
    directionAttribute: safeDirection,
    introHtml,
    listDateLabelHtml: escapeHtml(t("html_list_date_label")),
    listNameLabelHtml: escapeHtml(t("html_list_name_label")),
    listVersionLabelHtml: escapeHtml(t("html_list_version_label")),
    localeAttribute: safeLocale,
    monitorButtonTextHtml: safeMonitorUrl
      ? escapeHtml(t("view_monitor_label"))
      : undefined,
    monitorUrlAttribute: safeMonitorUrl,
    notesTitleHtml: escapeHtml(t("html_notes_title")),
    releaseBodyHtml,
    releaseDateHtml: safeHtmlDate,
    releaseNameHtml: safeReleaseName,
    releaseTagNameHtml: safeReleaseTagName,
    releaseUrlAttribute: safeReleaseUrl,
    subjectHtml,
    titleHtml,
  });
}

export async function sendNewReleaseEmail(
  repository: Repository,
  release: GithubRelease,
  locale: Locale,
  timeFormat: TimeFormat,
  toAddress?: string,
  includeReleaseNotes = true,
) {
  const t = await getTranslations({ locale, namespace: "Email" });

  const emailConfig = getEmailRuntimeConfig(process.env, toAddress);

  if (!emailConfig.isComplete) {
    logger
      .withScope("Email")
      .warn(
        "Email configuration is incomplete (missing host, port, from, or to address). Skipping email notification.",
      );
    throw new Error(t("error_config_incomplete"));
  }

  const subject = t("subject", {
    repoId: isolateLtrText(repository.id),
    tagName: isolateLtrText(release.tag_name),
  });
  const textBody = await generatePlainTextReleaseBody(
    release,
    repository,
    locale,
    timeFormat,
    includeReleaseNotes,
  );
  const htmlBody = await generateHtmlReleaseBody(
    release,
    repository,
    locale,
    timeFormat,
    includeReleaseNotes,
  );

  try {
    await sendEmailMessage(
      {
        host: emailConfig.host,
        port: emailConfig.port,
        username: emailConfig.username,
        password: emailConfig.password,
        tlsRejectUnauthorized: emailConfig.tlsRejectUnauthorized,
      },
      {
        fromName: emailConfig.fromName || t("from_name_fallback"),
        fromAddress: emailConfig.fromAddress,
        to: emailConfig.recipient,
        subject,
        text: textBody,
        html: htmlBody,
      },
    );
  } catch (error: unknown) {
    logger
      .withScope("Email")
      .error(`Failed to send email for ${repository.id}:`, error);
    const message =
      error instanceof Error ? error.message : String(error ?? "unknown");
    throw new Error(t("error_send_failed", { details: message }));
  }
}

export async function sendTestEmail(
  repository: Repository,
  release: GithubRelease,
  locale: Locale,
  timeFormat: TimeFormat,
  toAddress?: string,
  includeReleaseNotes = true,
) {
  const recipient = getEmailRuntimeConfig(process.env, toAddress).recipient;
  logger.withScope("Email").info(`Sending test email to ${recipient}...`);
  return sendNewReleaseEmail(
    repository,
    release,
    locale,
    timeFormat,
    recipient,
    includeReleaseNotes,
  );
}
