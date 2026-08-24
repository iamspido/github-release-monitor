import { getTranslations } from "next-intl/server";
import { remark } from "remark";
import remarkGfm from "remark-gfm";
import {
  isolateAutoText,
  isolateLtrText,
  stripBidiControlCharacters,
} from "@/lib/bidi";
import {
  consumeResponseWithTimeout,
  discardResponseWithTimeout,
  fetchWithTimeout,
} from "@/lib/http/fetch-with-timeout";
import { logger } from "@/lib/logger";
import { getReleaseMonitorUrl } from "@/lib/notifications/config";
import {
  escapeHtml,
  escapeMarkdownLinkDestination,
  escapeMarkdownText,
  safeExternalUrl,
} from "@/lib/notifications/content-safety";
import {
  generateHtmlReleaseBody,
  generateHtmlReleaseDigestBody,
  generatePlainTextReleaseBody,
  generatePlainTextReleaseLinkLines,
  getFormattedDate,
  type ReleaseNotificationItem,
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

function fitCompleteDigestEntries(
  header: string,
  entries: string[],
  footer: string | undefined,
  maxChars: number,
  omittedText: (count: number) => string,
): string {
  const join = (selected: string[], omitted: number, includedFooter?: string) =>
    [
      header,
      ...selected,
      omitted > 0 ? omittedText(omitted) : undefined,
      includedFooter,
    ]
      .filter((value): value is string => Boolean(value))
      .join("\n\n");
  if (maxChars <= 0) return join(entries, 0, footer);

  const selected: string[] = [];
  for (const entry of entries) {
    const candidate = [...selected, entry];
    if (join(candidate, entries.length - candidate.length).length > maxChars) {
      break;
    }
    selected.push(entry);
  }
  const omitted = entries.length - selected.length;
  const fittedWithoutFooter = join(selected, omitted);
  if (footer) {
    const fittedWithFooter = join(selected, omitted, footer);
    if (fittedWithFooter.length <= maxChars) return fittedWithFooter;
  }
  if (fittedWithoutFooter.length <= maxChars) return fittedWithoutFooter;

  const omissionNotice = omitted > 0 ? omittedText(omitted) : undefined;
  if (omissionNotice?.length && omissionNotice.length <= maxChars) {
    return omissionNotice;
  }
  if (header.length <= maxChars) return header;
  return (omissionNotice ?? header).substring(0, maxChars);
}

type MutableMarkdownNode = {
  type: string;
  value?: string;
  url?: string;
  title?: string | null;
  alt?: string | null;
  identifier?: string;
  children?: MutableMarkdownNode[];
};

type MarkdownDefinition = {
  url: string;
  title?: string | null;
};

function sanitizeMarkdownNode(node: MutableMarkdownNode): void {
  if (node.type === "html") {
    node.value = escapeHtml(node.value);
  }
  if (node.url !== undefined) {
    node.url = safeExternalUrl(node.url);
  }
  node.children?.forEach(sanitizeMarkdownNode);
}

function collectMarkdownDefinitions(
  node: MutableMarkdownNode,
  definitions: Map<string, MarkdownDefinition>,
): void {
  if (
    node.type === "definition" &&
    node.identifier !== undefined &&
    node.url !== undefined &&
    !definitions.has(node.identifier)
  ) {
    definitions.set(node.identifier, { url: node.url, title: node.title });
  }
  node.children?.forEach((child) => {
    collectMarkdownDefinitions(child, definitions);
  });
}

function inlineMarkdownReferences(
  node: MutableMarkdownNode,
  definitions: ReadonlyMap<string, MarkdownDefinition>,
): MutableMarkdownNode[] {
  if (node.type === "definition") return [];

  const children = node.children?.flatMap((child) =>
    inlineMarkdownReferences(child, definitions),
  );
  if (node.type === "linkReference") {
    const definition = node.identifier
      ? definitions.get(node.identifier)
      : undefined;
    if (!definition) return children ?? [];
    return [
      {
        type: "link",
        url: definition.url,
        title: definition.title,
        children: children ?? [],
      },
    ];
  }
  if (node.type === "imageReference") {
    const definition = node.identifier
      ? definitions.get(node.identifier)
      : undefined;
    if (!definition) return [{ type: "text", value: node.alt ?? "" }];
    return [
      {
        type: "image",
        url: definition.url,
        title: definition.title,
        alt: node.alt,
      },
    ];
  }
  if (children !== undefined) node.children = children;
  return [node];
}

export function normalizeMarkdownReleaseNotes(value: string): string {
  const processor = remark().use(remarkGfm);
  const tree = processor.parse(stripBidiControlCharacters(value));
  const mutableTree = tree as MutableMarkdownNode;
  sanitizeMarkdownNode(mutableTree);
  const definitions = new Map<string, MarkdownDefinition>();
  collectMarkdownDefinitions(mutableTree, definitions);
  inlineMarkdownReferences(mutableTree, definitions);
  return processor.stringify(tree).trim();
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

export function getEffectiveAppriseProfile(
  repository: Repository,
  settings: NotificationSettings,
): { tags?: string; format: AppriseFormat } {
  return {
    tags: repository.appriseTags ?? settings.appriseTags,
    format: repository.appriseFormat ?? settings.appriseFormat ?? "text",
  };
}

async function generateAppriseDigestBody(
  items: ReleaseNotificationItem[],
  format: AppriseFormat,
  locale: Locale,
  settings: NotificationSettings,
): Promise<string> {
  if (format === "html") {
    return generateHtmlReleaseDigestBody(
      items,
      locale,
      settings.timeFormat,
      settings.appriseIncludeReleaseNotes !== false,
    );
  }

  const t = await getTranslations({ locale, namespace: "Email" });
  const tApprise = await getTranslations({ locale, namespace: "Apprise" });
  const markdown = format === "markdown";
  const entries = await Promise.all(
    items.map(async ({ repository, release }) => {
      const { textDate } = await getFormattedDate(
        new Date(release.created_at),
        locale,
        settings.timeFormat,
      );
      if (markdown) {
        const lines = [
          `### [${escapeMarkdownText(isolateLtrText(repository.id))}](${escapeMarkdownLinkDestination(repository.url)}) — ${escapeMarkdownText(isolateLtrText(release.tag_name))}`,
          `* **${escapeMarkdownText(t("text_release_name_label"))}**: ${escapeMarkdownText(isolateAutoText(release.name || "N/A"))}`,
          `* **${escapeMarkdownText(t("text_release_date_label"))}**: ${escapeMarkdownText(isolateAutoText(textDate))}`,
        ];
        if (settings.appriseIncludeReleaseNotes !== false) {
          const normalizedReleaseNotes = release.body
            ? normalizeMarkdownReleaseNotes(release.body)
            : "";
          const releaseNotes =
            normalizedReleaseNotes || escapeMarkdownText(t("text_no_notes"));
          lines.push(
            `\n**${escapeMarkdownText(t("text_release_notes_label"))}**\n\n${releaseNotes}\n\n---`,
          );
        }
        lines.push(
          tApprise("view_on_github_link", {
            link: escapeMarkdownLinkDestination(release.html_url),
          }),
        );
        return lines.join("\n");
      }
      const body = await generatePlainTextReleaseBody(
        release,
        repository,
        locale,
        settings.timeFormat,
        settings.appriseIncludeReleaseNotes !== false,
        false,
      );
      return `${isolateLtrText(repository.id)} — ${isolateLtrText(release.tag_name)}\n${body.trim()}\n${t("text_view_on_github_label")}: ${isolateLtrText(release.html_url)}`;
    }),
  );
  const monitorUrl = getReleaseMonitorUrl(locale);
  const footer = monitorUrl
    ? markdown
      ? `[${escapeMarkdownText(t("view_monitor_label"))}](${escapeMarkdownLinkDestination(monitorUrl)})`
      : `${t("view_monitor_label")}: ${isolateLtrText(monitorUrl)}`
    : undefined;
  return fitCompleteDigestEntries(
    tApprise("digest_intro", { count: items.length }),
    entries,
    footer,
    settings.appriseMaxCharacters ?? 0,
    (count) => tApprise("digest_omitted", { count }),
  );
}

async function sendApprisePayload(
  payload: { title: string; body: string; format: AppriseFormat; tag?: string },
  locale: Locale,
  logLabel: string,
) {
  const { APPRISE_URL } = process.env;
  if (!APPRISE_URL) throw new Error("Apprise is no longer configured.");
  const t = await getTranslations({ locale, namespace: "Apprise" });
  try {
    const normalizedAppriseUrl = APPRISE_URL.replace(/\/+$/, "");
    const notifyUrl = /\/notify(\/|$)/.test(normalizedAppriseUrl)
      ? normalizedAppriseUrl
      : `${normalizedAppriseUrl}/notify`;
    const response = await fetchWithTimeout(notifyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const errorBody = await consumeResponseWithTimeout(response, (result) =>
        result.text(),
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
      .info(`Apprise notification sent successfully for ${logLabel}`);
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : String(error ?? "unknown");
    logger
      .withScope("Notifications")
      .error(`Failed to send Apprise notification for ${logLabel}: ${message}`);
    throw error instanceof Error ? error : new Error(message);
  }
}

export async function sendAppriseDigest(
  items: ReleaseNotificationItem[],
  locale: Locale,
  settings: NotificationSettings,
  profile: { tags?: string; format: AppriseFormat },
) {
  if (items.length === 0) return;
  const t = await getTranslations({ locale, namespace: "Apprise" });
  await sendApprisePayload(
    {
      title: t("digest_title", { count: items.length }),
      body: await generateAppriseDigestBody(
        items,
        profile.format,
        locale,
        settings,
      ),
      format: profile.format,
      ...(profile.tags ? { tag: profile.tags } : {}),
    },
    locale,
    `${items.length} release(s)`,
  );
}

export async function sendAppriseNotification(
  repository: Repository,
  release: GithubRelease,
  locale: Locale,
  settings: NotificationSettings,
) {
  const { APPRISE_URL } = process.env;
  const t = await getTranslations({ locale, namespace: "Apprise" });
  if (!APPRISE_URL) throw new Error(t("error_not_configured"));

  const { tags, format } = getEffectiveAppriseProfile(repository, settings);

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

  await sendApprisePayload(
    payload,
    locale,
    `${repository.id} ${release.tag_name}`,
  );
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
