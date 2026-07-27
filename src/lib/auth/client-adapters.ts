import { authClient } from "@/lib/auth/client";
import {
  type AccountLike,
  findAccountsArray,
} from "@/lib/auth/client-accounts";

export type PasskeyEntry = {
  id: string;
  name: string;
  createdAt: string | null;
};

export type AuthSessionSnapshot = {
  email: string;
  isPending: boolean;
  twoFactorEnabled: boolean;
};

export type TwoFactorEnableData = {
  totpURI: string | null;
  backupCodes: string[];
};

function hasClientError(value: unknown): boolean {
  return Boolean(
    value && typeof value === "object" && (value as { error?: unknown }).error,
  );
}

function normalizeCreatedAt(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    const millis = value < 1_000_000_000_000 ? value * 1_000 : value;
    return new Date(millis).toISOString();
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  return null;
}

export function normalizePasskeyList(payload: unknown): PasskeyEntry[] {
  const data = (payload as { data?: unknown } | null)?.data;
  const source = Array.isArray(data)
    ? data
    : Array.isArray((data as { passkeys?: unknown[] } | null)?.passkeys)
      ? (data as { passkeys: unknown[] }).passkeys
      : [];

  return source
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return null;
      }
      const value = entry as Record<string, unknown>;
      const id = typeof value.id === "string" ? value.id : "";
      if (!id) return null;
      const name =
        typeof value.name === "string" && value.name.trim()
          ? value.name.trim()
          : id.slice(0, 8);
      const createdAt = normalizeCreatedAt(
        value.createdAt ??
          value.created_at ??
          value.updatedAt ??
          value.updated_at,
      );
      return { id, name, createdAt };
    })
    .filter((entry): entry is PasskeyEntry => Boolean(entry));
}

export function readAuthSessionSnapshot(payload: unknown): AuthSessionSnapshot {
  const state =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};
  const data =
    state.data && typeof state.data === "object"
      ? (state.data as Record<string, unknown>)
      : {};
  const user =
    data.user && typeof data.user === "object"
      ? (data.user as Record<string, unknown>)
      : {};

  return {
    email: typeof user.email === "string" ? user.email : "",
    isPending: Boolean(state.isPending),
    twoFactorEnabled: Boolean(user.twoFactorEnabled),
  };
}

export function normalizeTwoFactorEnableResponse(
  payload: unknown,
): TwoFactorEnableData {
  const data = (payload as { data?: unknown } | null)?.data;
  const source =
    data && typeof data === "object"
      ? (data as Record<string, unknown>)
      : payload && typeof payload === "object"
        ? (payload as Record<string, unknown>)
        : {};
  const rawTotp =
    source.totpURI ??
    source.totpUri ??
    source.totp_url ??
    source.uri ??
    source.otpauthURL;
  const rawCodes = source.backupCodes;

  return {
    totpURI:
      typeof rawTotp === "string" && rawTotp.trim() ? rawTotp.trim() : null,
    backupCodes: Array.isArray(rawCodes)
      ? rawCodes
          .map((value) => (typeof value === "string" ? value.trim() : ""))
          .filter(Boolean)
      : [],
  };
}

export async function listAuthAccounts(): Promise<AccountLike[]> {
  const result = await authClient.listAccounts();
  if (hasClientError(result)) throw new Error("account_list_failed");
  return findAccountsArray(result);
}

export async function listPasskeys(): Promise<PasskeyEntry[]> {
  const result = await authClient.passkey.listUserPasskeys();
  if (hasClientError(result)) throw new Error("passkey_list_failed");
  return normalizePasskeyList(result);
}

export async function addPasskey(name?: string): Promise<boolean> {
  const result = await authClient.passkey.addPasskey({ name });
  return !hasClientError(result);
}

export async function deletePasskey(id: string): Promise<boolean> {
  const result = await authClient.passkey.deletePasskey({ id });
  return !hasClientError(result);
}

export async function enableTwoFactor(
  password: string,
): Promise<TwoFactorEnableData | null> {
  const result = await authClient.twoFactor.enable({ password });
  return hasClientError(result)
    ? null
    : normalizeTwoFactorEnableResponse(result);
}

export async function verifyTwoFactor(
  code: string,
  trustDevice: boolean,
): Promise<boolean> {
  const result = await authClient.twoFactor.verifyTotp({ code, trustDevice });
  return !hasClientError(result);
}

export async function disableTwoFactor(password: string): Promise<boolean> {
  const result = await authClient.twoFactor.disable({ password });
  return !hasClientError(result);
}
