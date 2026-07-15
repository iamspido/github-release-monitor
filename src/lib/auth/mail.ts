import nodemailer from "nodemailer";
import { getAuthSmtpConfig } from "@/lib/auth/config";
import { logger } from "@/lib/logger";

const log = logger.withScope("Auth");
const smtpConfig = getAuthSmtpConfig();
const smtpHost = smtpConfig.host;
const smtpPort = smtpConfig.port;
const smtpFromAddress = smtpConfig.fromAddress;
const smtpFromName = smtpConfig.fromName;
const smtpUsername = smtpConfig.username;
const smtpPassword = smtpConfig.password;

export const authEmailVerificationEnabled = smtpConfig.emailVerificationEnabled;

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
      error,
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
