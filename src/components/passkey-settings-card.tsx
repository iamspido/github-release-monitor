"use client";

import { Fingerprint, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

type PasskeyEntry = {
  id: string;
  name: string;
  createdAt: string | null;
};

function normalizeCreatedAt(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const millis = value < 1_000_000_000_000 ? value * 1_000 : value;
    return new Date(millis).toISOString();
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  return null;
}

function normalizePasskeys(response: unknown): PasskeyEntry[] {
  const data = (response as { data?: unknown })?.data;
  const source = Array.isArray(data)
    ? data
    : Array.isArray((data as { passkeys?: unknown[] })?.passkeys)
      ? (data as { passkeys: unknown[] }).passkeys
      : [];

  return source
    .map((entry) => {
      const value = entry as {
        id?: unknown;
        name?: unknown;
        createdAt?: unknown;
      };
      const id = typeof value.id === "string" ? value.id : "";
      if (!id) return null;
      const name =
        typeof value.name === "string" && value.name.trim()
          ? value.name.trim()
          : id.slice(0, 8);
      const createdAt = normalizeCreatedAt(
        value.createdAt ??
          (value as { created_at?: unknown }).created_at ??
          (value as { updatedAt?: unknown }).updatedAt ??
          (value as { updated_at?: unknown }).updated_at,
      );

      return { id, name, createdAt };
    })
    .filter((entry): entry is PasskeyEntry => Boolean(entry));
}

function formatTimestamp(value: string | null): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString();
}

export function PasskeySettingsCard() {
  const t = useTranslations("SettingsPage");
  const [passkeys, setPasskeys] = React.useState<PasskeyEntry[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isCreating, setIsCreating] = React.useState(false);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const [errorKey, setErrorKey] = React.useState<string | null>(null);
  const [passkeyName, setPasskeyName] = React.useState("");
  const nameInputId = React.useId();

  const refreshPasskeys = React.useCallback(async () => {
    setIsLoading(true);
    setErrorKey(null);
    try {
      const response = await authClient.passkey.listUserPasskeys();
      setPasskeys(normalizePasskeys(response));
    } catch {
      setErrorKey("passkeys_error_load");
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refreshPasskeys();
  }, [refreshPasskeys]);

  const handleCreatePasskey = async () => {
    if (isCreating || deletingId) return;
    setIsCreating(true);
    setErrorKey(null);
    try {
      const result = await authClient.passkey.addPasskey({
        name: passkeyName.trim() || undefined,
      });
      if (result.error) {
        setErrorKey("passkeys_error_create");
        return;
      }
      setPasskeyName("");
      await refreshPasskeys();
    } catch {
      setErrorKey("passkeys_error_create");
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeletePasskey = async (id: string) => {
    if (!id || deletingId || isCreating) return;
    setDeletingId(id);
    setErrorKey(null);
    try {
      const result = await authClient.passkey.deletePasskey({ id });
      if (result.error) {
        setErrorKey("passkeys_error_delete");
        return;
      }
      await refreshPasskeys();
    } catch {
      setErrorKey("passkeys_error_delete");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>{t("passkeys_title")}</CardTitle>
        <CardDescription>{t("passkeys_description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor={nameInputId}>{t("passkeys_name_label")}</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id={nameInputId}
              value={passkeyName}
              onChange={(event) => setPasskeyName(event.target.value)}
              placeholder={t("passkeys_name_placeholder")}
              maxLength={64}
            />
            <Button
              type="button"
              onClick={() => void handleCreatePasskey()}
              disabled={isCreating || Boolean(deletingId)}
              aria-busy={isCreating}
            >
              {isCreating ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Fingerprint className="mr-2 h-4 w-4" />
              )}
              {t("passkeys_add_button")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void refreshPasskeys()}
              disabled={isLoading || isCreating || Boolean(deletingId)}
              aria-busy={isLoading}
            >
              {isLoading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              {t("passkeys_refresh_button")}
            </Button>
          </div>
        </div>

        {errorKey && (
          <Alert variant="destructive">
            <AlertDescription>{t(errorKey)}</AlertDescription>
          </Alert>
        )}

        {isLoading ? (
          <p className="text-sm text-muted-foreground">
            {t("passkeys_loading")}
          </p>
        ) : passkeys.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("passkeys_empty")}</p>
        ) : (
          <ul className="space-y-2">
            {passkeys.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center justify-between rounded-md border p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{entry.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {t("passkeys_created_at", {
                      value: formatTimestamp(entry.createdAt),
                    })}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t("passkeys_delete_button")}
                  onClick={() => void handleDeletePasskey(entry.id)}
                  disabled={isCreating || deletingId === entry.id}
                >
                  {deletingId === entry.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
