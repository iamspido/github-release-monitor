import nodemailer from "nodemailer";
import { defaultLocale, getLocaleMetadata, type Locale } from "@/i18n/config";
import { getAuthSmtpConfig } from "@/lib/auth/config";
import { renderPasswordResetEmailHtml } from "@/lib/auth/password-reset-email-html";
import { getPasswordResetEmailMessages } from "@/lib/auth/password-reset-email-messages";
import { logger } from "@/lib/logger";
import { getLocaleSetting } from "@/lib/storage/settings";

const log = logger.withScope("Auth");
const smtpConfig = getAuthSmtpConfig();
const smtpHost = smtpConfig.host;
const smtpPort = smtpConfig.port;
const smtpFromAddress = smtpConfig.fromAddress;
const smtpFromName = smtpConfig.fromName;
const smtpUsername = smtpConfig.username;
const smtpPassword = smtpConfig.password;
const smtpTlsRejectUnauthorized = smtpConfig.tlsRejectUnauthorized;

export const authEmailVerificationEnabled = smtpConfig.emailVerificationEnabled;
export const authEmailDeliveryEnabled = smtpConfig.emailVerificationEnabled;

let authEmailTransporter: nodemailer.Transporter | null = null;

function maskEmailForLog(value: string) {
  const [localPart = "", domain = ""] = value.split("@", 2);
  if (!domain) return "<invalid-email>";
  return `${localPart.slice(0, 1) || "*"}***@${domain}`;
}

function isValidEmailTarget(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeHtmlAttribute(value: string) {
  return escapeHtml(value).replaceAll("`", "&#96;");
}

async function getPasswordResetEmailLocale(): Promise<Locale> {
  try {
    return await getLocaleSetting();
  } catch {
    log.warn(
      `Could not read the configured locale for the password reset email; using '${defaultLocale}'.`,
    );
    return defaultLocale;
  }
}

function getAuthEmailTransporter() {
  if (!authEmailVerificationEnabled) {
    return null;
  }
  if (authEmailTransporter) {
    return authEmailTransporter;
  }

  const authConfig =
    smtpUsername || smtpPassword
      ? {
          auth: {
            user: smtpUsername,
            pass: smtpPassword,
          },
        }
      : {};

  authEmailTransporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    tls: {
      rejectUnauthorized: smtpTlsRejectUnauthorized,
    },
    ...authConfig,
  });
  return authEmailTransporter;
}

async function sendAuthEmail(options: {
  to: string;
  subject: string;
  text: string;
  html: string;
}) {
  const transporter = getAuthEmailTransporter();
  if (!transporter) {
    log.warn(
      "Skipped auth email send because SMTP is not configured for auth verification.",
    );
    return;
  }

  const recipientLabel = maskEmailForLog(options.to);
  try {
    await transporter.sendMail({
      from: `"${smtpFromName}" <${smtpFromAddress}>`,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
    });
    log.info(
      `Auth email sent to '${recipientLabel}' with subject='${options.subject}'.`,
    );
  } catch (error) {
    log.error(
      `Failed to send auth email to '${recipientLabel}' with subject='${options.subject}'.`,
    );
    throw error;
  }
}

export async function sendNewEmailVerificationEmail(args: {
  newEmail: string;
  verificationUrl: string;
}) {
  if (!isValidEmailTarget(args.newEmail)) {
    return;
  }
  const newEmail = args.newEmail.trim();
  const safeNewEmail = escapeHtml(newEmail);
  const safeVerificationUrl = escapeHtmlAttribute(args.verificationUrl);
  const subject = "Confirm your new email address";
  const text = [
    "You requested to change your email address.",
    "",
    `New email: ${newEmail}`,
    "",
    `Confirm this change: ${args.verificationUrl}`,
    "",
    "If this wasn't you, you can ignore this email.",
  ].join("\n");
  const html = `
    <p>You requested to change your email address.</p>
    <p><strong>New email:</strong> ${safeNewEmail}</p>
    <p><a href="${safeVerificationUrl}">Confirm this change</a></p>
    <p>If this wasn't you, you can ignore this email.</p>
  `;

  await sendAuthEmail({
    to: newEmail,
    subject,
    text,
    html,
  });
}

export async function sendChangeEmailConfirmationToCurrentEmail(args: {
  currentEmail?: string | null;
  newEmail: string;
  confirmationUrl: string;
}) {
  if (!isValidEmailTarget(args.currentEmail)) {
    return;
  }
  const currentEmail = args.currentEmail.trim();
  const safeCurrentEmail = escapeHtml(currentEmail);
  const safeNewEmail = escapeHtml(args.newEmail);
  const safeConfirmationUrl = escapeHtmlAttribute(args.confirmationUrl);
  const subject = "Confirm your email change request";
  const text = [
    "You requested to change your account email address.",
    "",
    `Current email: ${currentEmail}`,
    `New email: ${args.newEmail}`,
    "",
    `If this was you, continue here: ${args.confirmationUrl}`,
    "",
    "If this wasn't you, do not open the link and secure your account.",
  ].join("\n");
  const html = `
    <p>You requested to change your account email address.</p>
    <p><strong>Current email:</strong> ${safeCurrentEmail}<br/>
    <strong>New email:</strong> ${safeNewEmail}</p>
    <p><a href="${safeConfirmationUrl}">Confirm this change request</a></p>
    <p>If this wasn't you, do not open the link and secure your account.</p>
  `;

  await sendAuthEmail({
    to: currentEmail,
    subject,
    text,
    html,
  });
}

export async function sendPasswordResetEmail(args: {
  email: string;
  resetUrl: string;
  expiresInSeconds: number;
}) {
  if (!isValidEmailTarget(args.email)) {
    return;
  }
  const email = args.email.trim();
  const safeResetUrl = escapeHtmlAttribute(args.resetUrl);
  const locale = await getPasswordResetEmailLocale();
  const direction = getLocaleMetadata(locale).direction;
  const messages = await getPasswordResetEmailMessages(locale);
  const durationValue =
    args.expiresInSeconds % 60 === 0
      ? args.expiresInSeconds / 60
      : args.expiresInSeconds;
  const durationUnit = args.expiresInSeconds % 60 === 0 ? "minute" : "second";
  const expiryLabel = new Intl.NumberFormat(locale, {
    style: "unit",
    unit: durationUnit,
    unitDisplay: "long",
  }).format(durationValue);
  const subject = messages.subject;
  const intro = messages.intro;
  const expiryNotice = messages.expiry_notice.replace(
    "{duration}",
    expiryLabel,
  );
  const ignoreNotice = messages.ignore_notice;
  const text = [
    messages.title,
    "",
    intro,
    "",
    `${messages.button}: ${args.resetUrl}`,
    "",
    expiryNotice,
    ignoreNotice,
  ].join("\n");
  const html = renderPasswordResetEmailHtml({
    actionUrlAttribute: safeResetUrl,
    buttonTextHtml: escapeHtml(messages.button),
    directionAttribute: escapeHtmlAttribute(direction),
    expiryNoticeHtml: escapeHtml(expiryNotice),
    ignoreNoticeHtml: escapeHtml(ignoreNotice),
    introHtml: escapeHtml(intro),
    localeAttribute: escapeHtmlAttribute(locale),
    subjectHtml: escapeHtml(subject),
    titleHtml: escapeHtml(messages.title),
  });

  await sendAuthEmail({
    to: email,
    subject,
    text,
    html,
  });
}
