import {
  getEnabledSocialProviders,
  isAuthPasskeyEnabled,
} from "@/lib/auth/config";
import { getAuthDb } from "@/lib/auth/db";
import {
  isSqliteMissingColumnError,
  isSqliteMissingTableError,
} from "@/lib/auth/repository-schema";
import type { SocialLoginProvider } from "@/lib/auth/social-login-intent";
import { logger } from "@/lib/logger";

const log = logger.withScope("Auth");

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
      return Boolean(getAuthDb().prepare(query).get(normalizedUserId));
    } catch (error) {
      if (isSqliteMissingColumnError(error)) continue;
      log.error(
        `Failed to check credential account linkage for user='${normalizedUserId}'.`,
        error,
      );
      return false;
    }
  }
  return false;
}

export function hasLinkedSocialProviderAccount(
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
      if (getAuthDb().prepare(query).get(normalizedUserId, provider))
        return true;
    } catch (error) {
      if (isSqliteMissingColumnError(error)) continue;
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

export function canUnlinkAccountForUser(userId: string, accountId: string) {
  const normalizedUserId = userId.trim();
  const normalizedAccountId = accountId.trim();
  if (!normalizedUserId || !normalizedAccountId) return false;

  const accounts = getAuthAccountsForUser(normalizedUserId);
  if (!accounts) return false;
  const targetAccount = accounts.find(
    (account) => account.id === normalizedAccountId,
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
  const accountId = getSocialProviderAccountIdForUser(userId, provider);
  return accountId ? canUnlinkAccountForUser(userId, accountId) : false;
}

export function getSocialProviderAccountIdForUser(
  userId: string,
  provider: SocialLoginProvider,
) {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) return null;
  const accounts = getAuthAccountsForUser(normalizedUserId);
  const account = accounts?.find(
    (candidate) => candidate.providerId === provider,
  );
  return typeof account?.id === "string" && account.id.trim()
    ? account.id.trim()
    : null;
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
    const enabled = userRow?.twoFactorEnabled;
    if (enabled !== true && enabled !== 1 && enabled !== "1") return false;
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
      return Boolean(getAuthDb().prepare(query).get(normalizedUserId));
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
      return Boolean(getAuthDb().prepare(query).get(normalizedUserId));
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
