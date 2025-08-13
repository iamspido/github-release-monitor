'use server';

import type { GithubRelease, Repository, AppSettings, AppriseFormat } from '@/types';
import { sendNewReleaseEmail, generatePlainTextReleaseBody, generateHtmlReleaseBody, getFormattedDate } from './email';
import { getTranslations } from 'next-intl/server';

async function generateMarkdownReleaseBody(release: GithubRelease, repository: Repository, locale: string, settings: AppSettings, maxChars: number): Promise<string> {
    const t = await getTranslations({ locale, namespace: 'Email' });
    const tApprise = await getTranslations({ locale, namespace: 'Apprise' });
    const { htmlDate } = await getFormattedDate(new Date(release.created_at), locale, settings.timeFormat);

    const viewOnGithubText = tApprise('view_on_github_link', {
        link: release.html_url,
    });
    const truncatedText = tApprise('truncated_message');
    const footerSeparator = '\n\n---\n\n';

    const title = tApprise('title', { repoId: repository.id, tagName: release.tag_name });
    const repoLink = `**[${repository.id}](${repository.url})**`;
    const introText = t('text_new_version_of_markdown').replace('REPO_PLACEHOLDER', repoLink);

    const header = `
## ${title}

${introText}

* **${t('text_version_label')}**: ${release.tag_name}
* **${t('text_release_name_label')}**: ${release.name || 'N/A'}
* **${t('text_release_date_label')}**: ${htmlDate}
`;

    let body = `${header.trim()}\n\n### ${t('text_release_notes_label')}\n---\n${release.body || t('text_no_notes')}`;

    if (maxChars > 0) {
        const footer = `${footerSeparator}${truncatedText}\n${viewOnGithubText}`;
        const availableLength = maxChars - footer.length;

        if (body.length > availableLength) {
            if (availableLength > 0) {
                body = body.substring(0, availableLength) + footer;
            } else {
                body = viewOnGithubText;
            }
        } else {
            body = `${body}${footerSeparator}${viewOnGithubText}`;
        }
    } else {
        body = `${body}${footerSeparator}${viewOnGithubText}`;
    }
    return body;
}

async function generateAppriseBody(release: GithubRelease, repository: Repository, format: AppriseFormat, locale: string, settings: AppSettings): Promise<string> {
    const maxChars = settings.appriseMaxCharacters ?? 0;
    const tApprise = await getTranslations({ locale, namespace: 'Apprise' });

    switch (format) {
        case 'html':
            return generateHtmlReleaseBody(release, repository, locale, settings.timeFormat);
        case 'markdown':
            return generateMarkdownReleaseBody(release, repository, locale, settings, maxChars);
        case 'text':
        default:
            const title = tApprise('title', { repoId: repository.id, tagName: release.tag_name });
            const plainTextBody = await generatePlainTextReleaseBody(release, repository, locale, settings.timeFormat);
            const fullBody = `${title}\n\n${plainTextBody.trim()}`;

            if (maxChars > 0 && fullBody.length > maxChars) {
                return fullBody.substring(0, maxChars);
            }
            return fullBody;
    }
}


async function sendAppriseNotification(repository: Repository, release: GithubRelease, locale: string, settings: AppSettings) {
    const { APPRISE_URL } = process.env;
    if (!APPRISE_URL) return;

    const t = await getTranslations({ locale, namespace: 'Apprise' });

    // Determine which settings to use
    const tags = repository.appriseTags ?? settings.appriseTags;
    // Default to 'text' if no format is specified anywhere
    const format = repository.appriseFormat ?? settings.appriseFormat ?? 'text';

    const title = t('title', { repoId: repository.id, tagName: release.tag_name });
    const body = await generateAppriseBody(release, repository, format, locale, settings);

    const payload: { title: string; body: string; format: AppriseFormat; tag?: string } = {
        title: title,
        body: body,
        format: format,
    };

    if (tags) {
        payload.tag = tags;
    }

    try {
        const normalizedAppriseUrl = APPRISE_URL.replace(/\/+$/, '');
        const notifyUrl = /\/notify(\/|$)/.test(normalizedAppriseUrl)
            ? normalizedAppriseUrl
            : `${normalizedAppriseUrl}/notify`;

        const response = await fetch(notifyUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const errorBody = await response.text();
            console.error(`Apprise notification for ${repository.id} failed with status ${response.status}: ${errorBody}`);
            throw new Error(t('error_send_failed_detailed', { status: response.status, details: errorBody }));
        } else {
            console.log(`Apprise notification sent successfully for ${repository.id} ${release.tag_name}`);
        }
    } catch (error: any) {
        console.error(`Failed to send Apprise notification for ${repository.id}. Please check if the service is running and the URL is correct. Error: ${error.message}`);
        throw error;
    }
}

export async function sendNotification(repository: Repository, release: GithubRelease, locale: string, settings: AppSettings) {
    const { MAIL_HOST, APPRISE_URL } = process.env;
    const notificationPromises = [];

    // Check and send SMTP email
    if (MAIL_HOST) {
        notificationPromises.push(sendNewReleaseEmail(repository, release, locale, settings.timeFormat));
    }

    // Check and send Apprise notification
    if (APPRISE_URL) {
        notificationPromises.push(sendAppriseNotification(repository, release, locale, settings));
    }

    if (notificationPromises.length === 0) {
        console.warn(`No notification services (SMTP or Apprise) are configured. Skipping notification for ${repository.id}.`);
        return;
    }

    // Execute all configured notification services
    const results = await Promise.allSettled(notificationPromises);

    // Check if any of the promises failed and re-throw an error if so.
    // This ensures that the calling function knows that a notification failed.
    const failed = results.find(result => result.status === 'rejected');
    if (failed) {
        // We log the specific reason in the respective functions.
        // Here, we just throw a generic error to signal failure.
        throw new Error("One or more notification services failed to send.");
    }
}

export async function sendTestAppriseNotification(repository: Repository, release: GithubRelease, locale: string, settings: AppSettings) {
    const t = await getTranslations({ locale, namespace: 'Apprise' });
    const { APPRISE_URL } = process.env;
    if (!APPRISE_URL) {
        throw new Error(t('error_not_configured'));
    }
    // For testing, we force text to ensure maximum compatibility.
    const testSettings = { ...settings, appriseFormat: 'text' as AppriseFormat };
    const testRepo = { ...repository, appriseFormat: 'text' as AppriseFormat };
    await sendAppriseNotification(testRepo, release, locale, testSettings);
}
