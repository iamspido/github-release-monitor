import {
  getEnabledSocialProviders,
  isAuthPasskeyEnabled,
} from "@/lib/auth/config";
import { getAuthDb } from "@/lib/auth/db";
import type { SocialLoginProvider } from "@/lib/auth/social-login-intent";
import { logger } from "@/lib/logger";
import { isUsernamePolicyValid } from "@/lib/username-policy";

const log = logger.withScope("Auth");

export type AuthUserExistence = "has_user" | "no_user" | "unknown";

function isSqliteMissingColumnError(error: unknown) {
  return (
    error instanceof Error &&
    typeof error.message === "string" &&
    error.message.toLowerCase().includes("no such column")
  );
}

function isSqliteMissingTableError(error: unknown) {
  return (
    error instanceof Error &&
    typeof error.message === "string" &&
    error.message.toLowerCase().includes("no such table")
  );
}

export function hasAnyAuthUser(): AuthUserExistence {
  try {
    const row = getAuthDb().prepare("SELECT id FROM user LIMIT 1").get();
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
      const row = getAuthDb().prepare(query).get(token) as
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
    const row = getAuthDb()
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
      getAuthDb()
        .prepare("UPDATE user SET username = ? WHERE id = ?")
        .run(normalizedUsername, row.id);
      usernameApplied = true;
    }

    if (normalizedName && !row.name?.trim()) {
      getAuthDb()
        .prepare("UPDATE user SET name = ? WHERE id = ?")
        .run(normalizedName, row.id);
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
      const row = getAuthDb().prepare(query).get(normalizedUserId);
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
    const row = getAuthDb()
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
    const row = getAuthDb()
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
    const rows = getAuthDb().prepare("SELECT id FROM user").all() as Array<{
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
    const rows = getAuthDb().prepare("PRAGMA table_info(user)").all() as Array<{
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
    const rows = getAuthDb()
      .prepare("SELECT id, email, username FROM user")
      .all() as AuthUserProfileRow[] | undefined;
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
    getAuthDb()
      .prepare(`UPDATE user SET ${assignments.join(", ")} WHERE id = ?`)
      .run(...values);
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
      const row = getAuthDb().prepare(query).get(normalizedUserId, provider);
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

export function getLinkedSocialProvidersForUser(userId: string) {
  return (["github", "google"] as const).filter((provider) =>
    hasLinkedSocialProviderAccount(userId, provider),
  );
}

type AuthAccountRow = {
  id?: string | null;
  accountId?: string | null;
  providerId?: string | null;
};

function getAuthAccountsForUser(userId: string): AuthAccountRow[] | null {
  const queries = [
    "SELECT id, accountId, providerId FROM account WHERE userId = ?",
    "SELECT id, account_id AS accountId, providerId FROM account WHERE userId = ?",
    "SELECT id, accountId, provider AS providerId FROM account WHERE userId = ?",
    "SELECT id, account_id AS accountId, provider AS providerId FROM account WHERE userId = ?",
    "SELECT id, accountId, providerId FROM account WHERE user_id = ?",
    "SELECT id, account_id AS accountId, providerId FROM account WHERE user_id = ?",
    "SELECT id, accountId, provider AS providerId FROM account WHERE user_id = ?",
    "SELECT id, account_id AS accountId, provider AS providerId FROM account WHERE user_id = ?",
  ] as const;

  for (const query of queries) {
    try {
      return getAuthDb().prepare(query).all(userId) as AuthAccountRow[];
    } catch (error) {
      if (
        isSqliteMissingColumnError(error) ||
        isSqliteMissingTableError(error)
      ) {
        continue;
      }
      log.error(`Failed to load linked accounts for user='${userId}'.`, error);
      return null;
    }
  }

  return null;
}

function isUsableAuthAccount(
  account: AuthAccountRow,
  enabledSocialProviders: ReadonlySet<string>,
) {
  return (
    account.providerId === "credential" ||
    (typeof account.providerId === "string" &&
      enabledSocialProviders.has(account.providerId))
  );
}

export function canUnlinkAccountForUser(
  userId: string,
  providerId: string,
  accountId?: string,
) {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId || !providerId) return false;

  const accounts = getAuthAccountsForUser(normalizedUserId);
  if (!accounts) return false;

  const targetAccount = accounts.find(
    (account) =>
      account.providerId === providerId &&
      (accountId === undefined || account.accountId === accountId),
  );
  if (!targetAccount) return false;

  const enabledSocialProviders = new Set(getEnabledSocialProviders());
  const hasUsableRemainingAccount = accounts.some(
    (account) =>
      account !== targetAccount &&
      isUsableAuthAccount(account, enabledSocialProviders),
  );

  return (
    hasUsableRemainingAccount ||
    (isAuthPasskeyEnabled() && hasPasskeyForUser(normalizedUserId))
  );
}

export function canUnlinkSocialProviderForUser(
  userId: string,
  provider: SocialLoginProvider,
) {
  return canUnlinkAccountForUser(userId, provider);
}

export function canDeletePasskeyForUser(userId: string, passkeyId: string) {
  const normalizedUserId = userId.trim();
  const normalizedPasskeyId = passkeyId.trim();
  if (!normalizedUserId || !normalizedPasskeyId || !isAuthPasskeyEnabled()) {
    return false;
  }

  const queries = [
    "SELECT id FROM passkey WHERE userId = ?",
    "SELECT id FROM passkey WHERE user_id = ?",
  ] as const;

  for (const query of queries) {
    try {
      const rows = getAuthDb().prepare(query).all(normalizedUserId) as Array<{
        id?: string | null;
      }>;
      const passkeyIds = rows
        .map((row) => (typeof row.id === "string" ? row.id.trim() : ""))
        .filter(Boolean);
      if (!passkeyIds.includes(normalizedPasskeyId)) return false;

      const enabledSocialProviders = new Set(getEnabledSocialProviders());
      const hasUsableSocialAccount = getLinkedSocialProvidersForUser(
        normalizedUserId,
      ).some((provider) => enabledSocialProviders.has(provider));

      return (
        passkeyIds.some((candidate) => candidate !== normalizedPasskeyId) ||
        hasCredentialPasswordAccount(normalizedUserId) ||
        hasUsableSocialAccount
      );
    } catch (error) {
      if (
        isSqliteMissingColumnError(error) ||
        isSqliteMissingTableError(error)
      ) {
        continue;
      }
      log.error(
        `Failed passkey deletion safety check for user='${normalizedUserId}' passkey='${normalizedPasskeyId}'.`,
        error,
      );
      return false;
    }
  }

  return false;
}

export function hasVerifiedTotpForUser(userId: string) {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) return false;

  try {
    const userRow = getAuthDb()
      .prepare("SELECT twoFactorEnabled FROM user WHERE id = ? LIMIT 1")
      .get(normalizedUserId) as
      | { twoFactorEnabled?: boolean | number | string | null }
      | undefined;
    const twoFactorEnabled = userRow?.twoFactorEnabled;
    if (
      twoFactorEnabled !== true &&
      twoFactorEnabled !== 1 &&
      twoFactorEnabled !== "1"
    ) {
      return false;
    }
  } catch (error) {
    if (!isSqliteMissingColumnError(error)) {
      log.error(
        `Failed to check 2FA user flag for user='${normalizedUserId}'.`,
        error,
      );
    }
    return false;
  }

  const queries = [
    "SELECT id FROM twoFactor WHERE userId = ? AND verified = 1 LIMIT 1",
    "SELECT id FROM twoFactor WHERE user_id = ? AND verified = 1 LIMIT 1",
    "SELECT id FROM two_factor WHERE userId = ? AND verified = 1 LIMIT 1",
    "SELECT id FROM two_factor WHERE user_id = ? AND verified = 1 LIMIT 1",
  ] as const;

  for (const query of queries) {
    try {
      const row = getAuthDb().prepare(query).get(normalizedUserId);
      return Boolean(row);
    } catch (error) {
      if (
        isSqliteMissingColumnError(error) ||
        isSqliteMissingTableError(error)
      ) {
        continue;
      }
      log.error(
        `Failed to check TOTP linkage for user='${normalizedUserId}'.`,
        error,
      );
      return false;
    }
  }

  return false;
}

export function hasPasskeyForUser(userId: string) {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) return false;

  const queries = [
    "SELECT id FROM passkey WHERE userId = ? LIMIT 1",
    "SELECT id FROM passkey WHERE user_id = ? LIMIT 1",
  ] as const;

  for (const query of queries) {
    try {
      const row = getAuthDb().prepare(query).get(normalizedUserId);
      return Boolean(row);
    } catch (error) {
      if (
        isSqliteMissingColumnError(error) ||
        isSqliteMissingTableError(error)
      ) {
        continue;
      }
      log.error(
        `Failed to check passkey linkage for user='${normalizedUserId}'.`,
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
  isProviderConfigured: (provider: SocialLoginProvider) => boolean,
): SocialLoginPrecheckResult {
  const normalizedIdentifier = identifier.trim();
  if (!normalizedIdentifier) return "invalid_input";
  if (!isProviderConfigured(provider)) return "provider_not_configured";

  const user = findAuthUserByIdentifier(normalizedIdentifier);
  if (!user) {
    return "unknown_or_unlinked";
  }

  return hasLinkedSocialProviderAccount(user.id, provider)
    ? "linked"
    : "unknown_or_unlinked";
}
