import { getAuthDb } from "@/lib/auth/db";
import { hasLinkedSocialProviderAccount } from "@/lib/auth/repository-login-methods";
import { isSqliteMissingColumnError } from "@/lib/auth/repository-schema";
import type { SocialLoginProvider } from "@/lib/auth/social-login-intent";
import { logger } from "@/lib/logger";
import { isUsernamePolicyValid } from "@/lib/username-policy";

const log = logger.withScope("Auth");

export {
  canDeletePasskeyForUser,
  canUnlinkAccountForUser,
  canUnlinkSocialProviderForUser,
  getLinkedSocialProvidersForUser,
  getSocialProviderAccountIdForUser,
  hasCredentialPasswordAccount,
  hasPasskeyForUser,
  hasVerifiedTotpForUser,
} from "@/lib/auth/repository-login-methods";
export {
  type AuthUserExistence,
  hasAnyAuthUser,
  hasValidAuthSessionForRequest,
} from "@/lib/auth/repository-session";

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
