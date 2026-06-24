export type AccountLike = {
  provider?: string | { id?: string | null; name?: string | null } | null;
  providerId?: string | null;
};

export type LinkedSocialProvider = "github" | "google";

export type LinkedSocialAccountMap = Partial<
  Record<LinkedSocialProvider, true>
>;

export function findAccountsArray(payload: unknown): AccountLike[] {
  if (Array.isArray(payload)) {
    return payload as AccountLike[];
  }
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const record = payload as Record<string, unknown>;
  const nestedCandidates: unknown[] = [
    record.data,
    record.accounts,
    record.result,
    record.response,
  ];
  for (const candidate of nestedCandidates) {
    if (Array.isArray(candidate)) {
      return candidate as AccountLike[];
    }
    if (candidate && typeof candidate === "object") {
      const nested = candidate as Record<string, unknown>;
      if (Array.isArray(nested.accounts)) {
        return nested.accounts as AccountLike[];
      }
      if (Array.isArray(nested.data)) {
        return nested.data as AccountLike[];
      }
    }
  }
  return [];
}

export function getAccountProviderId(value: AccountLike): string {
  const providerRaw =
    typeof value.provider === "string"
      ? value.provider
      : value.provider?.id || value.provider?.name || "";
  return String(value.providerId || providerRaw || "")
    .trim()
    .toLowerCase();
}

export function hasCredentialProvider(payload: unknown): boolean {
  return findAccountsArray(payload).some(
    (account) => getAccountProviderId(account) === "credential",
  );
}

export function toSocialProvider(value: string): LinkedSocialProvider | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.includes("github")) return "github";
  if (normalized.includes("google")) return "google";
  return null;
}

export function extractLinkedAccounts(
  payload: unknown,
): LinkedSocialAccountMap {
  const linked: LinkedSocialAccountMap = {};
  for (const account of findAccountsArray(payload)) {
    const provider = toSocialProvider(getAccountProviderId(account));
    if (provider) {
      linked[provider] = true;
    }
  }
  return linked;
}
