import nodemailer from "nodemailer";
import { logger } from "@/lib/logger";

const SMTP_CONNECTION_TIMEOUT_MS = 15_000;
const SMTP_GREETING_TIMEOUT_MS = 15_000;
const SMTP_SOCKET_TIMEOUT_MS = 30_000;

export type EmailMessage = {
  fromName: string;
  fromAddress: string;
  to: string;
  subject: string;
  text: string;
  html: string;
};

export type EmailTransportConfig = {
  host: string;
  port: number;
  username?: string;
  password?: string;
  tlsRejectUnauthorized: boolean;
};

export async function sendEmailMessage(
  config: EmailTransportConfig,
  message: EmailMessage,
) {
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    connectionTimeout: SMTP_CONNECTION_TIMEOUT_MS,
    greetingTimeout: SMTP_GREETING_TIMEOUT_MS,
    socketTimeout: SMTP_SOCKET_TIMEOUT_MS,
    tls: {
      rejectUnauthorized: config.tlsRejectUnauthorized,
    },
    auth: {
      user: config.username,
      pass: config.password,
    },
  });

  await transporter.sendMail({
    from: `"${message.fromName}" <${message.fromAddress}>`,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });

  logger
    .withScope("Email")
    .info(
      `Email notification sent to ${message.to} with subject='${message.subject}'`,
    );
}
