"use client";

import { CheckCircle2, Loader2, Unlink2 } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";
import { GoogleBrandIcon } from "@/components/google-brand-icon";
import { GithubBrandIcon } from "@/components/icons/simple-brand-icon";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useNetworkStatus } from "@/hooks/use-network";
import { authClient } from "@/lib/auth/client";

type SocialProvider = "github" | "google";

interface SocialAccountsSettingsCardProps {
  enabledSocialProviders: SocialProvider[];
}

interface AccountLike {
  provider?: string | { id?: string | null; name?: string | null } | null;
  providerId?: string | null;
}

function toSocialProvider(value: string): SocialProvider | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.includes("github")) return "github";
  if (normalized.includes("google")) return "google";
  return null;
}

function findAccountsArray(payload: unknown): AccountLike[] {
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

type LinkedAccountMap = Partial<Record<SocialProvider, true>>;

function extractLinkedAccounts(payload: unknown): LinkedAccountMap {
  const accounts = findAccountsArray(payload);
  const linked: LinkedAccountMap = {};
  for (const account of accounts) {
    const providerRaw =
      typeof account.provider === "string"
        ? account.provider
        : account.provider?.id || account.provider?.name || "";
    const provider = toSocialProvider(
      String(account.providerId || providerRaw || ""),
    );
    if (provider) {
      linked[provider] = true;
    }
  }
  return linked;
}

export function SocialAccountsSettingsCard({
  enabledSocialProviders,
}: SocialAccountsSettingsCardProps) {
  const t = useTranslations("SettingsPage");
  const { isOnline } = useNetworkStatus();
  const [pendingProvider, setPendingProvider] =
    React.useState<SocialProvider | null>(null);
  const [errorKey, setErrorKey] = React.useState<string | null>(null);
  const [accountsLoading, setAccountsLoading] = React.useState(true);
  const [linkedAccounts, setLinkedAccounts] = React.useState<LinkedAccountMap>(
    {},
  );

  const providerLabel: Record<SocialProvider, string> = {
    github: "GitHub",
    google: "Google",
  };

  React.useEffect(() => {
    let active = true;
    (async () => {
      try {
        const result = await authClient.listAccounts();
        if (!active) return;
        setLinkedAccounts(extractLinkedAccounts(result));
      } catch {
        if (!active) return;
        setErrorKey("social_accounts_status_error");
      } finally {
        if (active) {
          setAccountsLoading(false);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const handleLinkSocial = async (provider: SocialProvider) => {
    if (pendingProvider || accountsLoading || linkedAccounts[provider]) {
      return;
    }
    setErrorKey(null);
    setPendingProvider(provider);

    try {
      const callbackURL =
        typeof window === "undefined" ? "/settings" : window.location.pathname;
      const result = await authClient.linkSocial({
        provider,
        callbackURL,
      });
      if (result?.error) {
        setErrorKey("social_accounts_link_error");
      }
    } catch {
      setErrorKey("social_accounts_link_error");
    } finally {
      setPendingProvider(null);
    }
  };

  const handleUnlinkSocial = async (provider: SocialProvider) => {
    if (pendingProvider || accountsLoading || !linkedAccounts[provider]) {
      return;
    }
    setErrorKey(null);
    setPendingProvider(provider);

    try {
      const result = await authClient.unlinkAccount({
        providerId: provider,
      });
      if (result?.error) {
        setErrorKey("social_accounts_unlink_error");
        return;
      }
      setLinkedAccounts((previous) => {
        const next = { ...previous };
        delete next[provider];
        return next;
      });
    } catch {
      setErrorKey("social_accounts_unlink_error");
    } finally {
      setPendingProvider(null);
    }
  };

  if (enabledSocialProviders.length === 0) {
    return null;
  }

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>{t("social_accounts_title")}</CardTitle>
        <CardDescription>{t("social_accounts_description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {accountsLoading && (
          <div className="text-sm text-muted-foreground">
            {t("social_accounts_loading")}
          </div>
        )}
        {enabledSocialProviders.map((provider) => {
          const isPending = pendingProvider === provider;
          const isLinked = Boolean(linkedAccounts[provider]);
          const isActionDisabled =
            Boolean(pendingProvider) || !isOnline || accountsLoading;
          return (
            <div
              key={provider}
              className="flex items-center justify-between gap-3 rounded-md border p-3"
            >
              <div className="flex min-w-0 items-center gap-3">
                {provider === "github" ? (
                  <GithubBrandIcon className="h-5 w-5 shrink-0" />
                ) : (
                  <GoogleBrandIcon className="h-5 w-5 shrink-0" />
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {providerLabel[provider]}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {isLinked
                      ? t("social_accounts_connected_button", {
                          provider: providerLabel[provider],
                        })
                      : t("social_accounts_connect_button", {
                          provider: providerLabel[provider],
                        })}
                  </p>
                </div>
              </div>
              {isLinked ? (
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => void handleUnlinkSocial(provider)}
                  disabled={isActionDisabled}
                  aria-busy={isPending}
                >
                  {isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Unlink2 className="mr-2 h-4 w-4" />
                  )}
                  {t("social_accounts_unlink_button")}
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => void handleLinkSocial(provider)}
                  disabled={isActionDisabled}
                  aria-busy={isPending}
                >
                  {isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                  )}
                  {t("social_accounts_connect_button", {
                    provider: providerLabel[provider],
                  })}
                </Button>
              )}
            </div>
          );
        })}
        {errorKey && (
          <Alert variant="destructive">
            <AlertDescription>{t(errorKey)}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
