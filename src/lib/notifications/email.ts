import { getTranslations } from "next-intl/server";
import { remark } from "remark";
import remarkGfm from "remark-gfm";
import remarkHtml from "remark-html";
import { logger } from "@/lib/logger";
import { getEmailRuntimeConfig } from "@/lib/notifications/config";
import {
  escapeHtml,
  escapeHtmlAttribute,
  safeExternalUrl,
} from "@/lib/notifications/content-safety";
import { renderReleaseEmailHtml } from "@/lib/notifications/email-html-template";
import { sendEmailMessage } from "@/lib/notifications/email-transport";
import type { GithubRelease, Repository, TimeFormat } from "@/types";

export async function getFormattedDate(
  date: Date,
  locale: string,
  timeFormat: TimeFormat,
): Promise<{ textDate: string; htmlDate: string }> {
  const t = await getTranslations({ locale, namespace: "Email" });

  const textDateFormattingOptions: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    timeZoneName: "short",
    hour12: timeFormat === "12h",
  };
  const textFormattingLocale =
    locale === "de" ? "de-DE" : timeFormat === "12h" ? "en-US" : "en-GB";
  const textDate = date.toLocaleString(
    textFormattingLocale,
    textDateFormattingOptions,
  );

  const htmlTimeOptions: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
    hour12: timeFormat === "12h",
  };
  const htmlDatePartsOptions: Intl.DateTimeFormatOptions = {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  };
  const dateParts = new Intl.DateTimeFormat(locale, htmlDatePartsOptions)
    .formatToParts(date)
    .reduce<Record<string, string>>((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {});
  const timeString = new Intl.DateTimeFormat(locale, htmlTimeOptions).format(
    date,
  );

  const htmlDate =
    timeFormat === "12h"
      ? `${dateParts.weekday}, ${dateParts.month} ${dateParts.day}, ${dateParts.year} ${t("html_date_conjunction_at")} ${timeString}`
      : `${dateParts.weekday}, ${dateParts.day}. ${dateParts.month} ${dateParts.year}, ${timeString}`;

  return { textDate, htmlDate };
}

export async function generatePlainTextReleaseBody(
  release: GithubRelease,
  repository: Repository,
  locale: string,
  timeFormat: TimeFormat,
): Promise<string> {
  const t = await getTranslations({ locale, namespace: "Email" });
  const { htmlDate } = await getFormattedDate(
    new Date(release.created_at),
    locale,
    timeFormat,
  );

  return `
${t("text_new_version_of", { repoId: repository.id })}

${t("text_version_label")}: ${release.tag_name}
${t("text_release_name_label")}: ${release.name || "N/A"}
${t("text_release_date_label")}: ${htmlDate}

${t("text_release_notes_label")}:
${release.body || t("text_no_notes")}

${t("text_view_on_github_label")}: ${release.html_url}
`;
}

export async function generateHtmlReleaseBody(
  release: GithubRelease,
  repository: Repository,
  locale: string,
  timeFormat: TimeFormat,
): Promise<string> {
  const t = await getTranslations({ locale, namespace: "Email" });
  const subject = t("subject", {
    repoId: repository.id,
    tagName: release.tag_name,
  });
  const subjectHtml = escapeHtml(subject);
  const { htmlDate } = await getFormattedDate(
    new Date(release.created_at),
    locale,
    timeFormat,
  );
  const safeLocale = escapeHtmlAttribute(locale);
  const safeRepoId = escapeHtml(repository.id);
  const safeRepoUrl = escapeHtmlAttribute(safeExternalUrl(repository.url));
  const safeReleaseTagName = escapeHtml(release.tag_name);
  const safeReleaseName = escapeHtml(release.name || "N/A");
  const safeReleaseUrl = escapeHtmlAttribute(safeExternalUrl(release.html_url));
  const safeHtmlDate = escapeHtml(htmlDate);

  const releaseBodyHtml = release.body
    ? String(
        await remark()
          .use(remarkGfm)
          .use(remarkHtml, { sanitize: true })
          .process(release.body),
      )
    : `<p style="font-style: italic;">${escapeHtml(t("html_no_notes"))}</p>`;

  const repoLink = `<a href="${safeRepoUrl}" style="color: #8c9fe8; text-decoration: none;"><strong style="color: #fafafa;">${safeRepoId}</strong></a>`;
  const introHtml = t("html_intro", { repoId: "REPO_PLACEHOLDER" }).replace(
    "REPO_PLACEHOLDER",
    repoLink,
  );

  return renderReleaseEmailHtml({
    buttonTextHtml: escapeHtml(t("html_button_text")),
    introHtml,
    listDateLabelHtml: escapeHtml(t("html_list_date_label")),
    listNameLabelHtml: escapeHtml(t("html_list_name_label")),
    listVersionLabelHtml: escapeHtml(t("html_list_version_label")),
    localeAttribute: safeLocale,
    notesTitleHtml: escapeHtml(t("html_notes_title")),
    releaseBodyHtml,
    releaseDateHtml: safeHtmlDate,
    releaseNameHtml: safeReleaseName,
    releaseTagNameHtml: safeReleaseTagName,
    releaseUrlAttribute: safeReleaseUrl,
    subjectHtml,
    titleHtml: escapeHtml(
      t("html_title", {
        repoId: repository.id,
        tagName: release.tag_name,
      }),
    ),
  });
}

export async function sendNewReleaseEmail(
  repository: Repository,
  release: GithubRelease,
  locale: string,
  timeFormat: TimeFormat,
  toAddress?: string,
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
    repoId: repository.id,
    tagName: release.tag_name,
  });
  const textBody = await generatePlainTextReleaseBody(
    release,
    repository,
    locale,
    timeFormat,
  );
  const htmlBody = await generateHtmlReleaseBody(
    release,
    repository,
    locale,
    timeFormat,
  );

  try {
    await sendEmailMessage(
      {
        host: emailConfig.host,
        port: emailConfig.port,
        username: emailConfig.username,
        password: emailConfig.password,
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
  locale: string,
  timeFormat: TimeFormat,
  toAddress?: string,
) {
  const recipient = getEmailRuntimeConfig(process.env, toAddress).recipient;
  logger.withScope("Email").info(`Sending test email to ${recipient}...`);
  return sendNewReleaseEmail(
    repository,
    release,
    locale,
    timeFormat,
    recipient,
  );
}
