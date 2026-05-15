import { mkdirSync } from "node:fs";
import path from "node:path";
import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { nextCookies } from "better-auth/next-js";
import { twoFactor, username } from "better-auth/plugins";
import Database from "better-sqlite3";
import nodemailer from "nodemailer";
import type { SocialLoginProvider } from "@/lib/auth-social-login-intent";
import { logger } from "@/lib/logger";
import { isUsernamePolicyValid } from "@/lib/username-policy";

const log = logger.withScope("Auth");
const dataDirPath = path.join(process.cwd(), "data");
const authDbPath = path.join(dataDirPath, "auth.db");
const https = process.env.HTTPS !== "false";

mkdirSync(dataDirPath, { recursive: true });

const db = new Database(authDbPath);
const signupEnabled = process.env.AUTH_ENABLE_SIGNUP === "true";
const passkeyEnabled = process.env.AUTH_ENABLE_PASSKEY !== "false";
const trustedSocialLinkingEnabled =
  process.env.AUTH_TRUST_SOCIAL_LINKING !== "false";
const secret = process.env.BETTER_AUTH_SECRET || process.env.AUTH_SECRET;
const githubClientId = process.env.AUTH_GITHUB_CLIENT_ID?.trim();
const githubClientSecret = process.env.AUTH_GITHUB_CLIENT_SECRET?.trim();
const googleClientId = process.env.AUTH_GOOGLE_CLIENT_ID?.trim();
const googleClientSecret = process.env.AUTH_GOOGLE_CLIENT_SECRET?.trim();
const smtpHost = process.env.MAIL_HOST?.trim() || "";
const smtpPortRaw = process.env.MAIL_PORT?.trim() || "";
const smtpFromAddress = process.env.MAIL_FROM_ADDRESS?.trim() || "";
const smtpFromName =
  process.env.MAIL_FROM_NAME?.trim() || "GitHub Release Monitor";
const smtpUsername = process.env.MAIL_USERNAME?.trim() || "";
const smtpPassword = process.env.MAIL_PASSWORD?.trim() || "";
const smtpPort = Number.parseInt(smtpPortRaw, 10);

const authEmailVerificationEnabled =
  smtpHost.length > 0 &&
  Number.isFinite(smtpPort) &&
  smtpPort > 0 &&
  smtpFromAddress.length > 0;

let authEmailTransporter: nodemailer.Transporter | null = null;

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

  try {
    await transporter.sendMail({
      from: `"${smtpFromName}" <${smtpFromAddress}>`,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
    });
    log.info(
      `Auth email sent to '${options.to}' with subject='${options.subject}'.`,
    );
  } catch (error) {
    log.error(
      `Failed to send auth email to '${options.to}' with subject='${options.subject}'.`,
      error,
    );
  }
}

async function sendNewEmailVerificationEmail(args: {
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

async function sendChangeEmailConfirmationToCurrentEmail(args: {
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
function buildSocialProviders(disableImplicitSignUp: boolean) {
  return {
    ...(githubClientId && githubClientSecret
      ? {
          github: {
            clientId: githubClientId,
            clientSecret: githubClientSecret,
            scope: ["read:user", "user:email"],
            disableImplicitSignUp,
          },
        }
      : {}),
    ...(googleClientId && googleClientSecret
      ? {
          google: {
            clientId: googleClientId,
            clientSecret: googleClientSecret,
            scope: ["openid", "profile", "email"],
            disableImplicitSignUp,
          },
        }
      : {}),
  };
}

const authSocialProviders = buildSocialProviders(!signupEnabled);
const setupSocialProviders = buildSocialProviders(false);
const hasSocialProviders = Object.keys(authSocialProviders).length > 0;
const trustedSocialProviders = trustedSocialLinkingEnabled
  ? Object.keys(authSocialProviders)
  : [];
const authPlugins = [
  username(),
  twoFactor({
    issuer: "GitHub Release Monitor",
  }),
  ...(passkeyEnabled ? [passkey()] : []),
  nextCookies(),
];

const configuredSocialProviders = Object.keys(authSocialProviders);
log.info(
  `Better Auth boot config: db='${authDbPath}', signup_enabled=${signupEnabled}, passkey_enabled=${passkeyEnabled}, trusted_social_linking=${trustedSocialLinkingEnabled}, social_providers=${
    configuredSocialProviders.length > 0
      ? configuredSocialProviders.join(",")
      : "none"
  }, secure_cookies=${https}, email_change_verification=${authEmailVerificationEnabled}.`,
);

if (!secret || secret.length < 32) {
  const message =
    "CRITICAL: Missing or insecure BETTER_AUTH_SECRET (or AUTH_SECRET fallback). Must be at least 32 characters long.";
  log.error(message);
  throw new Error(message);
}

const authBaseConfig = {
  database: db,
  secret,
  baseURL: process.env.BETTER_AUTH_URL || process.env.BETTER_AUTH_BASE_URL,
  user: {
    changeEmail: {
      enabled: true,
      // Better Auth only allows this for currently unverified accounts. Verified
      // accounts still require the new address to complete email verification.
      updateEmailWithoutVerification: !authEmailVerificationEnabled,
      ...(authEmailVerificationEnabled
        ? {
            sendChangeEmailConfirmation: async (
              payload: {
                user: { email: string };
                newEmail: string;
                url: string;
                token: string;
              },
              _request?: Request,
            ) =>
              sendChangeEmailConfirmationToCurrentEmail({
                currentEmail: payload.user?.email,
                newEmail: payload.newEmail,
                confirmationUrl: payload.url,
              }),
          }
        : {}),
    },
  },
  ...(authEmailVerificationEnabled
    ? {
        emailVerification: {
          sendVerificationEmail: async (
            payload: {
              user: { email: string };
              url: string;
              token: string;
            },
            _request?: Request,
          ) => {
            const newEmail = payload.user?.email || "";
            if (!isValidEmailTarget(newEmail)) {
              return;
            }
            void sendNewEmailVerificationEmail({
              newEmail,
              verificationUrl: payload.url,
            });
          },
        },
      }
    : {}),
  advanced: {
    useSecureCookies: https,
    defaultCookieAttributes: {
      secure: https,
      httpOnly: true,
      // OAuth callbacks (GitHub/Google) are cross-site navigations.
      // "strict" breaks social linking/sign-in because auth cookies are not sent.
      sameSite: "lax" as const,
    },
  },
  account: {
    accountLinking: {
      enabled: true,
      // Required for explicit account linking when provider email differs
      // (e.g. GitHub noreply/private email vs local email/password account).
      allowDifferentEmails: true,
      ...(trustedSocialProviders.length > 0
        ? { trustedProviders: trustedSocialProviders }
        : {}),
    },
  },
  plugins: authPlugins,
};

const authConfig = {
  ...authBaseConfig,
  emailAndPassword: {
    enabled: true,
    disableSignUp: !signupEnabled,
  },
  ...(hasSocialProviders ? { socialProviders: authSocialProviders } : {}),
};

const setupAuthConfig = {
  ...authBaseConfig,
  emailAndPassword: {
    enabled: true,
    disableSignUp: false,
  },
  ...(hasSocialProviders ? { socialProviders: setupSocialProviders } : {}),
};

export const auth = betterAuth(authConfig);
export const setupAuth = betterAuth(setupAuthConfig);

export function isAuthEmailVerificationEnabled() {
  return authEmailVerificationEnabled;
}

export function isSignupEnabled() {
  return signupEnabled;
}

export function isSocialProviderConfigured(provider: SocialLoginProvider) {
  if (provider === "github") {
    return Boolean(githubClientId && githubClientSecret);
  }
  return Boolean(googleClientId && googleClientSecret);
}

let authDatabaseReadyPromise: Promise<void> | null = null;

export async function ensureAuthDatabaseReady() {
  if (authDatabaseReadyPromise) {
    log.debug(
      "Auth database readiness already initialized; reusing existing promise.",
    );
    return authDatabaseReadyPromise;
  }

  authDatabaseReadyPromise = (async () => {
    log.info("Checking Better Auth database migrations.");
    const migrations = await getMigrations(authConfig);
    if (migrations.toBeCreated.length > 0 || migrations.toBeAdded.length > 0) {
      log.info(
        `Applying Better Auth migrations (create=${migrations.toBeCreated.length}, add=${migrations.toBeAdded.length}).`,
      );
    } else {
      log.debug(
        "Better Auth schema already up to date (no migrations needed).",
      );
    }
    await migrations.runMigrations();
    log.info("Better Auth migration check completed.");
  })().catch((error) => {
    authDatabaseReadyPromise = null;
    log.error("Better Auth migration check failed.", error);
    throw error;
  });

  return authDatabaseReadyPromise;
}

export type AuthUserExistence = "has_user" | "no_user" | "unknown";

export function hasAnyAuthUser(): AuthUserExistence {
  try {
    const row = db.prepare("SELECT id FROM user LIMIT 1").get();
    log.debug(`Auth user existence check result: ${Boolean(row)}.`);
    return row ? "has_user" : "no_user";
  } catch (error) {
    log.error(
      "Auth user existence check failed; setup-related flows will fail closed.",
      error,
    );
    return "unknown";
  }
}

function getCookieValue(rawCookieHeader: string | null, name: string) {
  if (!rawCookieHeader) return null;
  const targetPrefix = `${name}=`;
  for (const part of rawCookieHeader.split(";")) {
    const segment = part.trim();
    if (!segment.startsWith(targetPrefix)) continue;
    return segment.slice(targetPrefix.length);
  }
  return null;
}

function parseExpiryTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

export function hasValidAuthSessionForRequest(request: Request) {
  const rawCookieHeader = request.headers.get("cookie");
  const rawToken =
    getCookieValue(rawCookieHeader, "better-auth.session_token") ||
    getCookieValue(rawCookieHeader, "__Secure-better-auth.session_token");
  if (!rawToken) return false;

  const token = decodeURIComponent(rawToken.trim());
  if (!token) return false;

  const queries = [
    "SELECT userId, expiresAt FROM session WHERE token = ? LIMIT 1",
    "SELECT user_id, expires_at FROM session WHERE token = ? LIMIT 1",
  ] as const;

  for (const query of queries) {
    try {
      const row = db.prepare(query).get(token) as
        | {
            userId?: string | null;
            user_id?: string | null;
            expiresAt?: string | number | null;
            expires_at?: string | number | null;
          }
        | undefined;
      if (!row) continue;

      const userId = String(row.userId || row.user_id || "").trim();
      if (!userId) continue;

      const expiresAtMs = parseExpiryTimestamp(
        row.expiresAt ?? row.expires_at ?? null,
      );
      if (typeof expiresAtMs === "number" && expiresAtMs <= Date.now()) {
        return false;
      }
      return true;
    } catch (error) {
      if (isSqliteMissingColumnError(error)) {
        continue;
      }
      log.error(
        "Failed to validate Better Auth session token from request.",
        error,
      );
      return false;
    }
  }

  return false;
}

type InitialAuthUserProfile = {
  username: string;
  name?: string;
};

type InitialAuthUserProfileResult = {
  email: string | null;
  usernameApplied: boolean;
  nameApplied: boolean;
};

export function ensureInitialAuthUserProfile(
  profile: InitialAuthUserProfile,
): InitialAuthUserProfileResult | null {
  const normalizedUsername = profile.username.trim().toLowerCase();
  const normalizedName = profile.name?.trim() || "";

  if (!normalizedUsername) {
    return null;
  }

  try {
    const row = db
      .prepare("SELECT id, email, username, name FROM user LIMIT 1")
      .get() as
      | {
          id: string;
          email?: string | null;
          username?: string | null;
          name?: string | null;
        }
      | undefined;

    if (!row) {
      return null;
    }

    let usernameApplied = false;
    let nameApplied = false;

    if (!row.username?.trim()) {
      db.prepare("UPDATE user SET username = ? WHERE id = ?").run(
        normalizedUsername,
        row.id,
      );
      usernameApplied = true;
    }

    if (normalizedName && !row.name?.trim()) {
      db.prepare("UPDATE user SET name = ? WHERE id = ?").run(
        normalizedName,
        row.id,
      );
      nameApplied = true;
    }

    return {
      email: row.email || null,
      usernameApplied,
      nameApplied,
    };
  } catch (error) {
    log.error("Failed to enforce initial auth user profile.", error);
    return null;
  }
}

function isSqliteMissingColumnError(error: unknown) {
  return (
    error instanceof Error &&
    typeof error.message === "string" &&
    error.message.toLowerCase().includes("no such column")
  );
}

export function hasCredentialPasswordAccount(userId: string) {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) return false;

  const queries = [
    "SELECT id FROM account WHERE userId = ? AND providerId = 'credential' LIMIT 1",
    "SELECT id FROM account WHERE userId = ? AND provider = 'credential' LIMIT 1",
    "SELECT id FROM account WHERE user_id = ? AND providerId = 'credential' LIMIT 1",
    "SELECT id FROM account WHERE user_id = ? AND provider = 'credential' LIMIT 1",
  ] as const;

  for (const query of queries) {
    try {
      const row = db.prepare(query).get(normalizedUserId);
      return Boolean(row);
    } catch (error) {
      if (isSqliteMissingColumnError(error)) {
        continue;
      }
      log.error(
        `Failed to check credential account linkage for user='${normalizedUserId}'.`,
        error,
      );
      return false;
    }
  }

  return false;
}

type AuthUserLookup = {
  id: string;
};

function findAuthUserByUsername(username: string): AuthUserLookup | null {
  const normalizedUsername = username.trim().toLowerCase();
  if (!normalizedUsername) return null;

  try {
    const row = db
      .prepare("SELECT id FROM user WHERE lower(username) = lower(?) LIMIT 1")
      .get(normalizedUsername) as AuthUserLookup | undefined;
    return row?.id ? row : null;
  } catch (error) {
    if (isSqliteMissingColumnError(error)) {
      return null;
    }
    log.error(
      `Failed to look up auth user by username='${normalizedUsername}'.`,
      error,
    );
    return null;
  }
}

function findAuthUserByEmail(email: string): AuthUserLookup | null {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return null;

  try {
    const row = db
      .prepare("SELECT id FROM user WHERE lower(email) = lower(?) LIMIT 1")
      .get(normalizedEmail) as AuthUserLookup | undefined;
    return row?.id ? row : null;
  } catch (error) {
    log.error(
      `Failed to look up auth user by email='${normalizedEmail}'.`,
      error,
    );
    return null;
  }
}

function findAuthUserByIdentifier(identifier: string): AuthUserLookup | null {
  const normalizedIdentifier = identifier.trim().toLowerCase();
  if (!normalizedIdentifier) return null;

  return (
    findAuthUserByUsername(normalizedIdentifier) ||
    findAuthUserByEmail(normalizedIdentifier)
  );
}

export type RegistrationConflictResult =
  | "none"
  | "username_in_use"
  | "email_in_use";

export function findRegistrationConflict(
  username: string,
  email?: string,
): RegistrationConflictResult {
  const normalizedUsername = username.trim();
  if (normalizedUsername && findAuthUserByUsername(normalizedUsername)) {
    return "username_in_use";
  }

  const normalizedEmail = (email || "").trim().toLowerCase();
  if (normalizedEmail && findAuthUserByEmail(normalizedEmail)) {
    return "email_in_use";
  }

  return "none";
}

export function getAuthUserIdSnapshot() {
  try {
    const rows = db.prepare("SELECT id FROM user").all() as Array<{
      id?: string | null;
    }>;
    return new Set(
      rows
        .map((row) => (typeof row.id === "string" ? row.id.trim() : ""))
        .filter(Boolean),
    );
  } catch (error) {
    log.error(
      "Failed to capture auth user snapshot before social callback.",
      error,
    );
    return null;
  }
}

type AuthUserProfileRow = {
  id: string;
  email?: string | null;
  username?: string | null;
};

function getUserTableColumns() {
  try {
    const rows = db.prepare("PRAGMA table_info(user)").all() as Array<{
      name?: string;
    }>;
    return new Set(
      rows
        .map((row) => (typeof row.name === "string" ? row.name : ""))
        .filter(Boolean),
    );
  } catch (error) {
    log.error("Failed to inspect auth user table columns.", error);
    return new Set<string>();
  }
}

function findNewAuthUsers(previousUserIds: Set<string>) {
  try {
    const rows = db.prepare("SELECT id, email, username FROM user").all() as
      | AuthUserProfileRow[]
      | undefined;
    return (rows || []).filter((row) => row.id && !previousUserIds.has(row.id));
  } catch (error) {
    log.error("Failed to find auth users created by social callback.", error);
    return [];
  }
}

export type SocialRegistrationProfileResult =
  | "applied"
  | "no_new_user"
  | "ambiguous_new_user"
  | "invalid_username"
  | "username_in_use"
  | "username_column_missing"
  | "update_failed";

export function applySocialRegistrationProfile(args: {
  previousUserIds: Set<string>;
  username: string;
  email?: string;
}): SocialRegistrationProfileResult {
  const displayUsername = args.username.trim();
  const normalizedUsername = displayUsername.toLowerCase();
  if (!isUsernamePolicyValid(displayUsername)) {
    return "invalid_username";
  }

  const newUsers = findNewAuthUsers(args.previousUserIds);
  if (newUsers.length === 0) {
    return "no_new_user";
  }
  if (newUsers.length > 1) {
    return "ambiguous_new_user";
  }

  const targetUser = newUsers[0];
  const existingUsernameUser = findAuthUserByUsername(normalizedUsername);
  if (existingUsernameUser && existingUsernameUser.id !== targetUser.id) {
    return "username_in_use";
  }

  const columns = getUserTableColumns();
  if (!columns.has("username")) {
    return "username_column_missing";
  }

  const assignments = ["username = ?"];
  const values: unknown[] = [normalizedUsername];
  if (columns.has("displayUsername")) {
    assignments.push("displayUsername = ?");
    values.push(displayUsername);
  } else if (columns.has("display_username")) {
    assignments.push("display_username = ?");
    values.push(displayUsername);
  }
  if (columns.has("updatedAt")) {
    assignments.push("updatedAt = ?");
    values.push(new Date());
  } else if (columns.has("updated_at")) {
    assignments.push("updated_at = ?");
    values.push(new Date().toISOString());
  }
  values.push(targetUser.id);

  try {
    db.prepare(`UPDATE user SET ${assignments.join(", ")} WHERE id = ?`).run(
      ...values,
    );
    if (
      args.email &&
      targetUser.email &&
      args.email.trim().toLowerCase() !== targetUser.email.trim().toLowerCase()
    ) {
      log.info(
        `Social registration applied username='${normalizedUsername}' to new user with provider email different from precheck email.`,
      );
    }
    return "applied";
  } catch (error) {
    log.error(
      `Failed to apply social registration username to user='${targetUser.id}'.`,
      error,
    );
    return "update_failed";
  }
}

function hasLinkedSocialProviderAccount(
  userId: string,
  provider: SocialLoginProvider,
) {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) return false;

  const queries = [
    "SELECT id FROM account WHERE userId = ? AND lower(providerId) = lower(?) LIMIT 1",
    "SELECT id FROM account WHERE userId = ? AND lower(provider) = lower(?) LIMIT 1",
    "SELECT id FROM account WHERE user_id = ? AND lower(providerId) = lower(?) LIMIT 1",
    "SELECT id FROM account WHERE user_id = ? AND lower(provider) = lower(?) LIMIT 1",
  ] as const;

  for (const query of queries) {
    try {
      const row = db.prepare(query).get(normalizedUserId, provider);
      if (row) {
        return true;
      }
    } catch (error) {
      if (isSqliteMissingColumnError(error)) {
        continue;
      }
      log.error(
        `Failed social account linkage check for user='${normalizedUserId}' provider='${provider}'.`,
        error,
      );
      return false;
    }
  }

  return false;
}

export type SocialLoginPrecheckResult =
  | "linked"
  | "unknown_or_unlinked"
  | "invalid_input"
  | "provider_not_configured";

export function precheckSocialLogin(
  identifier: string,
  provider: SocialLoginProvider,
): SocialLoginPrecheckResult {
  const normalizedIdentifier = identifier.trim();
  if (!normalizedIdentifier) return "invalid_input";
  if (!isSocialProviderConfigured(provider)) return "provider_not_configured";

  const user = findAuthUserByIdentifier(normalizedIdentifier);
  if (!user) {
    return "unknown_or_unlinked";
  }

  return hasLinkedSocialProviderAccount(user.id, provider)
    ? "linked"
    : "unknown_or_unlinked";
}
