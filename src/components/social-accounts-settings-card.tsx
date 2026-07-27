"use client";

import { CheckCircle2, Loader2, Unlink2 } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";
import { unlinkSocialAccountAction } from "@/app/auth/settings-actions";
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
import {
  extractLinkedAccounts,
  type LinkedSocialAccountMap,
  type LinkedSocialProvider,
} from "@/lib/auth/client-accounts";
import { listAuthAccounts } from "@/lib/auth/client-adapters";

type SocialProvider = LinkedSocialProvider;

interface SocialAccountsSettingsCardProps {
  enabledSocialProviders: SocialProvider[];
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
  const [linkedAccounts, setLinkedAccounts] =
    React.useState<LinkedSocialAccountMap>({});

  const providerLabel: Record<SocialProvider, string> = {
    github: "GitHub",
    google: "Google",
  };

  React.useEffect(() => {
    let active = true;
    (async () => {
      try {
        const result = await listAuthAccounts();
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
      const result = await unlinkSocialAccountAction(provider);
      if (!result.ok) {
        setErrorKey(result.errorKey ?? "social_accounts_unlink_error");
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
                    <Loader2 className="me-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Unlink2 className="me-2 h-4 w-4" />
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
                    <Loader2 className="me-2 h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="me-2 h-4 w-4" />
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
