
'use server';

import nodemailer from 'nodemailer';
import type { GithubRelease, Repository, TimeFormat } from '@/types';
import { getTranslations } from 'next-intl/server';
import { remark } from 'remark';
import remarkGfm from 'remark-gfm';
import remarkHtml from 'remark-html';

export async function sendNewReleaseEmail(repository: Repository, release: GithubRelease, locale: string, timeFormat: TimeFormat, toAddress?: string) {
  const t = await getTranslations({locale, namespace: 'Email'});

  const {
    MAIL_HOST,
    MAIL_PORT,
    MAIL_USERNAME,
    MAIL_PASSWORD,
    MAIL_FROM_ADDRESS,
    MAIL_FROM_NAME,
    MAIL_TO_ADDRESS,
  } = process.env;

  const recipient = toAddress || MAIL_TO_ADDRESS;

  // Check if email sending is configured
  if (!MAIL_HOST || !MAIL_PORT || !MAIL_FROM_ADDRESS || !recipient) {
    console.log('Email configuration is incomplete (missing host, port, from, or to address). Skipping email notification.');
    // Throw a translated error to indicate configuration failure
    throw new Error(t('error_config_incomplete'));
  }

  const port = parseInt(MAIL_PORT, 10);

  const transporter = nodemailer.createTransport({
    host: MAIL_HOST,
    port: port,
    // This is a more robust way to handle email security.
    // `secure: true` is only for port 465. For all other ports (like 587),
    // Nodemailer will automatically use STARTTLS if `secure` is false.
    secure: port === 465,
    auth: {
      user: MAIL_USERNAME,
      pass: MAIL_PASSWORD,
    },
  });

  const releaseBodyHtml = release.body 
    ? String(await remark().use(remarkGfm).use(remarkHtml).process(release.body))
    : `<p style="font-style: italic;">${t('html_no_notes')}</p>`;

  const subject = t('subject', {repoId: repository.id, tagName: release.tag_name});

  const releaseDate = new Date(release.created_at);

  // --- Custom Date/Time formatting logic ---
  // This logic ensures the date format is tied to the time format (12h/24h)
  // while the language is tied to the locale, without compromises.
  
  // Define options for the simpler text email format
  const textDateFormattingOptions: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    timeZoneName: 'short',
    hour12: timeFormat === '12h',
  };
  // For text emails, we can use a simpler locale-based format
  const textFormattingLocale = locale === 'de' ? 'de-DE' : (timeFormat === '12h' ? 'en-US' : 'en-GB');
  const formattedTextDate = releaseDate.toLocaleString(textFormattingLocale, textDateFormattingOptions);

  // For HTML emails, we need full control to meet the specific format requirements.
  // We get the translated parts and construct the string manually.
  const htmlTimeOptions: Intl.DateTimeFormatOptions = {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
    hour12: timeFormat === '12h',
  };
  const htmlDatePartsOptions: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  };
  
  // Get a map of translated date parts, e.g., { weekday: 'Tuesday', month: 'July', ... }
  const dateParts = new Intl.DateTimeFormat(locale, htmlDatePartsOptions)
    .formatToParts(releaseDate)
    .reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {} as Record<string, string>);

  const timeString = new Intl.DateTimeFormat(locale, htmlTimeOptions).format(releaseDate);
  let formattedHtmlDate;

  if (timeFormat === '12h') {
      // American format: Weekday, Month Day, Year at h:mm AM/PM
      formattedHtmlDate = `${dateParts.weekday}, ${dateParts.month} ${dateParts.day}, ${dateParts.year} ${t('html_date_conjunction_at')} ${timeString}`;
  } else {
      // European format: Weekday, Day. Month Year, H:mm
      formattedHtmlDate = `${dateParts.weekday}, ${dateParts.day}. ${dateParts.month} ${dateParts.year}, ${timeString}`;
  }
  // --- End of custom formatting logic ---

  const textBody = `
${t('text_new_version_of', {repoId: repository.id})}

${t('text_version_label')}: ${release.tag_name}
${t('text_release_name_label')}: ${release.name || 'N/A'}
${t('text_release_date_label')}: ${formattedTextDate}

${t('text_release_notes_label')}:
${release.body || t('text_no_notes')}

${t('text_view_on_github_label')}: ${release.html_url}
  `;

  const repoLink = `<a href="${repository.url}" style="color: #8c9fe8; text-decoration: none;"><strong style="color: #fafafa;">${repository.id}</strong></a>`;
  const introHtml = t('html_intro', {repoId: 'REPO_PLACEHOLDER'}).replace('REPO_PLACEHOLDER', repoLink);

  const htmlBody = `
    <!DOCTYPE html>
    <html lang="${locale}">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta name="color-scheme" content="dark">
      <meta name="supported-color-schemes" content="dark">
      <title>${subject}</title>
      <style>
        :root {
          color-scheme: dark;
        }
        body {
          margin: 0;
          padding: 0;
          width: 100%;
          background-color: #0d1117;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji';
          color: #c9d1d9;
          line-height: 1.6;
        }
        .container {
          background-color: #101928;
          padding: 20px;
          max-width: 680px;
          margin: 20px auto;
          border-radius: 8px;
          border: 1px solid #30363d;
        }
        .release-notes-container {
          background-color: #0d1117; 
          border: 1px solid #30363d; 
          border-radius: 6px; 
          padding: 1px 16px;
        }
        h1, h2, h3, h4, h5, h6 {
          color: #fafafa;
          margin-top: 24px;
          margin-bottom: 16px;
          font-weight: 600;
        }
        p {
          margin-top: 0;
          margin-bottom: 16px;
        }
        ul, ol {
          margin-top: 0;
          margin-bottom: 16px;
          padding-left: 2em;
        }
        li {
          margin-bottom: 4px;
        }
        a {
          color: #8c9fe8;
          text-decoration: none;
        }
        a:hover {
          text-decoration: underline;
        }
        pre {
          display: block;
          background-color: #161b22;
          color: #c9d1d9;
          padding: 16px;
          margin: 16px 0;
          border-radius: 6px;
          overflow-x: auto;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
          font-size: 14px;
          line-height: 1.45;
          word-break: normal;
          word-wrap: normal;
        }
        code {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
          font-size: 85%;
        }
        pre code {
          background-color: transparent;
          padding: 0;
          margin: 0;
          border-radius: 0;
        }
        code:not(pre code) {
           background-color: #30363d;
           padding: 0.2em 0.4em;
           margin: 0;
           border-radius: 6px;
           word-break: break-all;
        }
        blockquote {
          border-left: 4px solid #30363d;
          padding-left: 16px;
          color: #8b949e;
          margin: 0 0 16px;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          border-spacing: 0;
          display: block;
          overflow: auto;
        }
        th, td {
          padding: 6px 13px;
          border: 1px solid #30363d;
        }
        tr {
          background-color: transparent;
          border-top: 1px solid #30363d;
        }
        hr {
          border: 0;
          border-top: 1px solid #30363d;
          margin: 24px 0;
        }
        .button {
          display: inline-block; 
          background-color: #24292f; 
          color: #ffffff; 
          padding: 10px 20px; 
          text-decoration: none; 
          border-radius: 5px; 
          font-weight: 500;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h2>${t('html_title', {repoId: repository.id, tagName: release.tag_name})}</h2>
        <p>${introHtml}</p>
        <ul style="padding-left: 20px; margin-top: 16px; margin-bottom: 24px;">
          <li><strong style="color: #fafafa;">${t('html_list_version_label')}</strong> ${release.tag_name}</li>
          <li><strong style="color: #fafafa;">${t('html_list_name_label')}</strong> ${release.name || 'N/A'}</li>
          <li><strong style="color: #fafafa;">${t('html_list_date_label')}</strong> ${formattedHtmlDate}</li>
        </ul>
        <h3>${t('html_notes_title')}</h3>
        <div class="release-notes-container">
          ${releaseBodyHtml}
        </div>
        <p style="margin-top: 24px;">
          <a href="${release.html_url}" class="button">
            ${t('html_button_text')}
          </a>
        </p>
      </div>
    </body>
    </html>
  `;

  try {
    await transporter.sendMail({
      from: `"${MAIL_FROM_NAME || t('from_name_fallback')}" <${MAIL_FROM_ADDRESS}>`,
      to: recipient,
      subject: subject,
      text: textBody,
      html: htmlBody,
    });
    console.log(`Email notification sent to ${recipient} for ${repository.id} ${release.tag_name}`);
  } catch (error: any) {
    console.error(`Failed to send email for ${repository.id}:`, error);
    // Re-throw a translated error so the calling function can handle it
    throw new Error(t('error_send_failed', { details: error.message }));
  }
}
