import nodemailer from "nodemailer";
import { logger } from "@/lib/logger";

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
};

export async function sendEmailMessage(
  config: EmailTransportConfig,
  message: EmailMessage,
) {
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
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
