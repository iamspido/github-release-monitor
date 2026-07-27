"use client";

import { Fingerprint, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
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
import { useBrowserTimeZone } from "@/hooks/use-browser-time-zone";
import {
  addPasskey,
  deletePasskey,
  listPasskeys,
  type PasskeyEntry,
} from "@/lib/auth/client-adapters";
import { formatAbsoluteDateTime } from "@/lib/date-time";
import type { TimeFormat } from "@/types";

function parseTimestamp(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function PasskeySettingsCard({
  timeFormat,
}: {
  timeFormat: TimeFormat;
}) {
  const t = useTranslations("SettingsPage");
  const locale = useLocale();
  const browserTimeZone = useBrowserTimeZone();
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
      setPasskeys(await listPasskeys());
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
      const success = await addPasskey(passkeyName.trim() || undefined);
      if (!success) {
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
      if (!(await deletePasskey(id))) {
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
                <Loader2 className="me-2 h-4 w-4 animate-spin" />
              ) : (
                <Fingerprint className="me-2 h-4 w-4" />
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
                <Loader2 className="me-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="me-2 h-4 w-4" />
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
                  <p dir="auto" className="truncate text-sm font-medium">
                    {entry.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("passkeys_created_at", {
                      value: (() => {
                        const timestamp = parseTimestamp(entry.createdAt);
                        if (!timestamp || !browserTimeZone) return "-";
                        return formatAbsoluteDateTime(timestamp, {
                          locale,
                          timeFormat,
                          timeZone: browserTimeZone,
                          format: {
                            year: "numeric",
                            month: "numeric",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                            second: "2-digit",
                          },
                        });
                      })(),
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
