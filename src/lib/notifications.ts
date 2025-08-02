
'use server';

import type { GithubRelease, Repository, AppSettings } from '@/types';
import { sendNewReleaseEmail } from './email';
import { getTranslations } from 'next-intl/server';


async function sendAppriseNotification(repository: Repository, release: GithubRelease, locale: string, settings: AppSettings) {
    const { APPRISE_URL } = process.env;
    if (!APPRISE_URL) return;

    const t = await getTranslations({ locale, namespace: 'Apprise' });
    const maxChars = settings.appriseMaxCharacters ?? 0;

    const title = t('title', { repoId: repository.id, tagName: release.tag_name });

    const viewOnGithubText = t('view_on_github_link', {
        link: release.html_url,
    });
    const truncatedText = t('truncated_message');
    const footerSeparator = '\n\n---\n\n';

    let body = release.body || t('no_release_notes');

    if (maxChars > 0) {
        // Calculate the maximum length available for the body itself.
        const footer = `${footerSeparator}${truncatedText}\n${viewOnGithubText}`;
        const availableLength = maxChars - footer.length;
        
        if (body.length > availableLength) {
            if (availableLength > 0) {
                body = body.substring(0, availableLength) + footer;
            } else {
                // If the footer itself is too long, just use the link.
                // This is an edge case but good to handle.
                body = viewOnGithubText;
            }
        } else {
             body = `${body}${footerSeparator}${viewOnGithubText}`;
        }
    } else {
        body = `${body}${footerSeparator}${viewOnGithubText}`;
    }

    // Determine which tags to use: repository-specific tags override global tags.
    const tags = repository.appriseTags ?? settings.appriseTags;

    const payload: { title: string; body: string; format: 'markdown'; tag?: string } = {
        title: title,
        body: body,
        format: 'markdown',
    };

    if (tags) {
        payload.tag = tags;
    }

    try {
        // Determine the final notification URL.
        // If APPRISE_URL already contains `/notify`, use it directly.
        // Otherwise, append `/notify` for backward compatibility.
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
            // Propagate the specific error message from Apprise
            throw new Error(t('error_send_failed_detailed', { status: response.status, details: errorBody }));
        } else {
            console.log(`Apprise notification sent successfully for ${repository.id} ${release.tag_name}`);
        }
    } catch (error: any) {
        // This will now catch both fetch errors (like ENOTFOUND) and the re-thrown error from the !response.ok block.
        console.error(`Failed to send Apprise notification for ${repository.id}. Please check if the service is running and the URL is correct. Error: ${error.message}`);
        // Re-throw the original, more specific error message.
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
    await sendAppriseNotification(repository, release, locale, settings);
}
