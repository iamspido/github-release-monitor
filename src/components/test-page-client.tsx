"use client";

import { format } from "date-fns";
import {
  AlertTriangle,
  Bell,
  Eye,
  EyeOff,
  Loader2,
  Mail,
  PackagePlus,
  RefreshCw,
  Workflow,
} from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";

import {
  beginSecretRevealStepUpAction,
  completeSecretRevealStepUpAction,
  getSecretRevealOptionsAction,
  revealAppriseUrlAction,
  revealMailPasswordAction,
  verifySecretRevealTotpAction,
} from "@/app/actions";
import { SecretRevealDialog } from "@/components/diagnostics/secret-reveal-dialog";
import {
  buildSecretRevealCallbackUrl,
  getSecretRevealTargetFromSessionStorage,
  SECRET_REVEAL_TARGET_STORAGE_KEY,
  type SecretRevealMethods,
  type SecretRevealSocialProvider,
  type SecretRevealTarget,
} from "@/components/diagnostics/secret-reveal-model";
import { StatusIndicator } from "@/components/diagnostics/status-indicator";
import {
  CodebergBrandIcon,
  GithubBrandIcon,
  GitlabBrandIcon,
} from "@/components/icons/simple-brand-icon";
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
import { useDiagnosticsActions } from "@/hooks/use-diagnostics-actions";
import { useNetworkStatus } from "@/hooks/use-network";
import { useToast } from "@/hooks/use-toast";
import { authClient } from "@/lib/auth/client";
import { reloadIfServerActionStale } from "@/lib/server-action-error";
import { cn } from "@/lib/utils";
import type {
  AppriseStatus,
  CodebergTokenCheckResult,
  GitlabTokenCheckResult,
  NotificationConfig,
  RateLimitResult,
  UpdateNotificationState,
} from "@/types";

interface TestPageClientProps {
  rateLimitResult: RateLimitResult;
  isTokenSet: boolean;
  gitlabTokenCheck: GitlabTokenCheckResult;
  codebergTokenCheck: CodebergTokenCheckResult;
  notificationConfig: NotificationConfig;
  appriseStatus: AppriseStatus;
  updateNotice: UpdateNotificationState;
}

export function TestPageClient({
  rateLimitResult,
  isTokenSet,
  gitlabTokenCheck,
  codebergTokenCheck,
  notificationConfig,
  appriseStatus: initialAppriseStatus,
  updateNotice: initialUpdateNotice,
}: TestPageClientProps) {
  const t = useTranslations("TestPage");
  const [isRevealingMailPassword, startMailPasswordRevealTransition] =
    React.useTransition();
  const [isRevealingAppriseUrl, startAppriseUrlRevealTransition] =
    React.useTransition();

  const { toast } = useToast();
  const [resetTime, setResetTime] = React.useState(t("not_available"));
  const {
    appriseStatus,
    customEmail,
    handleEmailChange,
    handleManualUpdateCheck,
    handleRefreshAppriseStatus,
    handleSendTestApprise,
    handleSendTestEmail,
    handleSetupTestRepo,
    handleTriggerReleaseCheck,
    isCheckingApprise,
    isCheckingUpdate,
    isEmailInvalid,
    isSendingApprise,
    isSendingMail,
    isSettingUpRepo,
    isTriggeringCheck,
    updateNotice,
  } = useDiagnosticsActions({
    initialAppriseStatus,
    initialUpdateNotice,
    t,
  });
  const [revealedMailPassword, setRevealedMailPassword] = React.useState<
    string | null
  >(null);
  const [mailPasswordDialogOpen, setMailPasswordDialogOpen] =
    React.useState(false);
  const [mailPasswordConfirmValue, setMailPasswordConfirmValue] =
    React.useState("");
  const [mailPasswordRevealError, setMailPasswordRevealError] =
    React.useState("");
  const [revealedAppriseUrl, setRevealedAppriseUrl] = React.useState<
    string | null
  >(null);
  const [appriseUrlDialogOpen, setAppriseUrlDialogOpen] = React.useState(false);
  const [appriseUrlConfirmValue, setAppriseUrlConfirmValue] =
    React.useState("");
  const [appriseUrlRevealError, setAppriseUrlRevealError] = React.useState("");
  const [secretRevealMethods, setSecretRevealMethods] =
    React.useState<SecretRevealMethods | null>(null);
  const [secretRevealOptionsLoading, setSecretRevealOptionsLoading] =
    React.useState(false);
  const [secretRevealTotpCode, setSecretRevealTotpCode] = React.useState("");
  const [secretRevealStepUpError, setSecretRevealStepUpError] =
    React.useState("");
  const [secretRevealPendingMethod, setSecretRevealPendingMethod] =
    React.useState<string | null>(null);
  const emailInputId = React.useId();

  const rateLimitData = rateLimitResult.data;
  const rateLimitError = rateLimitResult.error;
  const rateLimit = rateLimitData?.rate;
  const { isOnline } = useNetworkStatus();

  const isRateLimitHigh = rateLimit ? rateLimit.limit > 1000 : false;
  const appriseUrlVariable = notificationConfig.variables.find(
    (variable) => variable.key === "APPRISE_URL",
  );
  const formattedLastChecked = React.useMemo(() => {
    if (!updateNotice.lastCheckedAt) {
      return t("update_last_checked_never");
    }

    const date = new Date(updateNotice.lastCheckedAt);
    if (Number.isNaN(date.getTime())) {
      return t("update_last_checked_never");
    }

    return t("update_last_checked", {
      time: format(date, "yyyy-MM-dd HH:mm:ss"),
    });
  }, [updateNotice.lastCheckedAt, t]);

  const updateStatus = React.useMemo(() => {
    if (updateNotice.lastCheckError) {
      return {
        status: "error" as const,
        text: t("update_error_status", { error: updateNotice.lastCheckError }),
      };
    }

    if (updateNotice.shouldNotify) {
      return {
        status: "warning" as const,
        text: t("update_available_status", {
          version: updateNotice.latestVersion ?? t("not_available"),
        }),
      };
    }

    return {
      status: "success" as const,
      text: t("update_not_available_status"),
    };
  }, [
    updateNotice.lastCheckError,
    updateNotice.shouldNotify,
    updateNotice.latestVersion,
    t,
  ]);

  const latestVersionText = updateNotice.latestVersion
    ? t("update_latest_known", { version: updateNotice.latestVersion })
    : t("update_latest_known_none");

  React.useEffect(() => {
    if (rateLimit) {
      // Format the time on the client to avoid hydration mismatch
      const clientFormattedTime = format(
        new Date(rateLimit.reset * 1000),
        "HH:mm:ss",
      );
      setResetTime(clientFormattedTime);
    }
  }, [rateLimit]);

  React.useEffect(
    () => () => {
      setRevealedMailPassword(null);
      setRevealedAppriseUrl(null);
    },
    [],
  );

  const isGitlabTokenSet = gitlabTokenCheck.status !== "not_set";
  const gitlabTokenStatusText = isGitlabTokenSet
    ? t("gitlab_token_set")
    : t("gitlab_token_not_set");
  const gitlabTokenStatus: "success" | "warning" = isGitlabTokenSet
    ? "success"
    : "warning";

  const gitlabAuthStatus = (() => {
    switch (gitlabTokenCheck.status) {
      case "not_set":
        return { status: "warning" as const, text: t("unauth_access") };
      case "valid":
        return gitlabTokenCheck.diagnosticsLimited
          ? {
              status: "warning" as const,
              text: t("gitlab_token_valid_limited"),
            }
          : { status: "success" as const, text: t("auth_access_confirmed") };
      case "invalid_token":
        return { status: "error" as const, text: t("gitlab_token_invalid") };
      case "api_error":
        return {
          status: "error" as const,
          text: t("gitlab_token_check_error"),
        };
    }
  })();

  const gitlabDetails: React.ReactNode[] = [];
  if (gitlabTokenCheck.status === "valid") {
    if (gitlabTokenCheck.username) {
      gitlabDetails.push(
        <p key="gitlab-auth-as">
          {t("gitlab_authenticated_as", {
            login: gitlabTokenCheck.username,
          })}
        </p>,
      );
    }

    if (gitlabTokenCheck.name) {
      gitlabDetails.push(
        <p key="gitlab-auth-name">
          {t("gitlab_authenticated_name", {
            name: gitlabTokenCheck.name,
          })}
        </p>,
      );
    }

    if (gitlabTokenCheck.diagnosticsLimited) {
      gitlabDetails.push(
        <p key="gitlab-limited-advice">
          {t("gitlab_token_valid_limited_advice")}
        </p>,
      );
    }
  }

  if (gitlabTokenCheck.status === "invalid_token") {
    gitlabDetails.push(
      <p key="gitlab-invalid-advice">{t("gitlab_invalid_token_advice")}</p>,
    );
  }

  if (gitlabTokenCheck.status === "api_error") {
    gitlabDetails.push(
      <p key="gitlab-api-error-advice">
        {t("gitlab_token_check_error_advice")}
      </p>,
    );
  }

  gitlabDetails.push(<p key="gitlab-api-note">{t("gitlab_api_limit_note")}</p>);

  const isCodebergTokenSet = codebergTokenCheck.status !== "not_set";
  const codebergTokenStatusText = isCodebergTokenSet
    ? t("codeberg_token_set")
    : t("codeberg_token_not_set");
  const codebergTokenStatus: "success" | "warning" = isCodebergTokenSet
    ? "success"
    : "warning";

  const codebergAuthStatus = (() => {
    switch (codebergTokenCheck.status) {
      case "not_set":
        return { status: "warning" as const, text: t("unauth_access") };
      case "valid":
        return codebergTokenCheck.diagnosticsLimited
          ? {
              status: "warning" as const,
              text: t("codeberg_token_valid_limited"),
            }
          : { status: "success" as const, text: t("auth_access_confirmed") };
      case "invalid_token":
        return { status: "error" as const, text: t("codeberg_token_invalid") };
      case "api_error":
        return {
          status: "error" as const,
          text: t("codeberg_token_check_error"),
        };
    }
  })();

  const codebergDetails: React.ReactNode[] = [];
  if (codebergTokenCheck.status === "valid") {
    if (codebergTokenCheck.login) {
      codebergDetails.push(
        <p key="codeberg-auth-as">
          {t("codeberg_authenticated_as", {
            login: codebergTokenCheck.login,
          })}
        </p>,
      );
    }

    if (codebergTokenCheck.diagnosticsLimited) {
      codebergDetails.push(
        <p key="codeberg-limited-advice">
          {t("codeberg_token_valid_limited_advice")}
        </p>,
      );
    }
  }

  if (codebergTokenCheck.status === "invalid_token") {
    codebergDetails.push(
      <p key="codeberg-invalid-advice">{t("codeberg_invalid_token_advice")}</p>,
    );
  }

  if (codebergTokenCheck.status === "api_error") {
    codebergDetails.push(
      <p key="codeberg-api-error-advice">
        {t("codeberg_token_check_error_advice")}
      </p>,
    );
  }

  codebergDetails.push(
    <p key="codeberg-api-limit">{t("codeberg_api_limit", { limit: 2000 })}</p>,
  );

  const handleMailPasswordRevealResult = (
    result: Awaited<ReturnType<typeof revealMailPasswordAction>>,
  ) => {
    if (result.success) {
      setRevealedMailPassword(result.value);
      setMailPasswordDialogOpen(false);
      setMailPasswordConfirmValue("");
      setMailPasswordRevealError("");
      return;
    }

    setMailPasswordRevealError(t(result.errorKey));
    toast({
      title: t("toast_error_title"),
      description: t(result.errorKey),
      variant: "destructive",
    });
  };

  const handleMailPasswordToggle = (
    revealMode: "none" | "external_click" | "password_confirm",
  ) => {
    if (revealedMailPassword !== null) {
      setRevealedMailPassword(null);
      return;
    }

    if (revealMode === "external_click") {
      startMailPasswordRevealTransition(async () => {
        try {
          const result = await revealMailPasswordAction();
          handleMailPasswordRevealResult(result);
        } catch (error: unknown) {
          if (reloadIfServerActionStale(error)) {
            return;
          }
          toast({
            title: t("toast_error_title"),
            description: t("error_reveal_failed"),
            variant: "destructive",
          });
        }
      });
      return;
    }

    if (revealMode === "password_confirm") {
      openSecretRevealDialog("mail_password");
    }
  };

  const handleConfirmMailPasswordReveal = () => {
    setMailPasswordRevealError("");
    startMailPasswordRevealTransition(async () => {
      try {
        const result = await revealMailPasswordAction({
          currentPassword: mailPasswordConfirmValue,
        });
        handleMailPasswordRevealResult(result);
      } catch (error: unknown) {
        if (reloadIfServerActionStale(error)) {
          return;
        }
        setMailPasswordRevealError(t("error_reveal_failed"));
        toast({
          title: t("toast_error_title"),
          description: t("error_reveal_failed"),
          variant: "destructive",
        });
      }
    });
  };

  const handleAppriseUrlRevealResult = (
    result: Awaited<ReturnType<typeof revealAppriseUrlAction>>,
  ) => {
    if (result.success) {
      setRevealedAppriseUrl(result.value);
      setAppriseUrlDialogOpen(false);
      setAppriseUrlConfirmValue("");
      setAppriseUrlRevealError("");
      return;
    }

    setAppriseUrlRevealError(t(result.errorKey));
    toast({
      title: t("toast_error_title"),
      description: t(result.errorKey),
      variant: "destructive",
    });
  };

  const setTargetRevealError = (
    target: SecretRevealTarget,
    message: string,
  ) => {
    if (target === "mail_password") {
      setMailPasswordRevealError(message);
      return;
    }
    setAppriseUrlRevealError(message);
  };

  const loadSecretRevealOptions = async () => {
    setSecretRevealOptionsLoading(true);
    setSecretRevealStepUpError("");
    try {
      const result = await getSecretRevealOptionsAction();
      if (result.success) {
        setSecretRevealMethods(result.methods);
        return;
      }
      setSecretRevealStepUpError(t(result.errorKey));
    } catch (error: unknown) {
      if (reloadIfServerActionStale(error)) {
        return;
      }
      setSecretRevealStepUpError(t("error_step_up_unavailable"));
    } finally {
      setSecretRevealOptionsLoading(false);
    }
  };

  const openSecretRevealDialog = (target: SecretRevealTarget) => {
    setSecretRevealTotpCode("");
    setSecretRevealStepUpError("");
    setSecretRevealPendingMethod(null);
    if (target === "mail_password") {
      setMailPasswordRevealError("");
      setMailPasswordConfirmValue("");
      setMailPasswordDialogOpen(true);
    } else {
      setAppriseUrlRevealError("");
      setAppriseUrlConfirmValue("");
      setAppriseUrlDialogOpen(true);
    }
    void loadSecretRevealOptions();
  };

  const handleSecretRevealDialogOpenChange = (
    target: SecretRevealTarget,
    open: boolean,
  ) => {
    if (target === "mail_password") {
      setMailPasswordDialogOpen(open);
      if (!open) {
        setMailPasswordConfirmValue("");
        setMailPasswordRevealError("");
      }
    } else {
      setAppriseUrlDialogOpen(open);
      if (!open) {
        setAppriseUrlConfirmValue("");
        setAppriseUrlRevealError("");
      }
    }

    if (!open) {
      setSecretRevealTotpCode("");
      setSecretRevealStepUpError("");
      setSecretRevealPendingMethod(null);
    }
  };

  const revealSecretAfterStepUp = async (target: SecretRevealTarget) => {
    if (target === "mail_password") {
      const result = await revealMailPasswordAction();
      handleMailPasswordRevealResult(result);
      return result.success;
    }

    const result = await revealAppriseUrlAction();
    handleAppriseUrlRevealResult(result);
    return result.success;
  };

  const handleTotpStepUp = (target: SecretRevealTarget) => {
    const startTransition =
      target === "mail_password"
        ? startMailPasswordRevealTransition
        : startAppriseUrlRevealTransition;
    startTransition(async () => {
      setSecretRevealPendingMethod("totp");
      setSecretRevealStepUpError("");
      try {
        const result = await verifySecretRevealTotpAction({
          code: secretRevealTotpCode,
          target,
        });
        if (!result.success) {
          const message = t(result.errorKey);
          setSecretRevealStepUpError(message);
          setTargetRevealError(target, message);
          return;
        }
        await revealSecretAfterStepUp(target);
      } catch (error: unknown) {
        if (reloadIfServerActionStale(error)) {
          return;
        }
        const message = t("error_step_up_failed");
        setSecretRevealStepUpError(message);
        setTargetRevealError(target, message);
      } finally {
        setSecretRevealPendingMethod(null);
      }
    });
  };

  const handlePasskeyStepUp = (target: SecretRevealTarget) => {
    const startTransition =
      target === "mail_password"
        ? startMailPasswordRevealTransition
        : startAppriseUrlRevealTransition;
    startTransition(async () => {
      setSecretRevealPendingMethod("passkey");
      setSecretRevealStepUpError("");
      try {
        const beginResult = await beginSecretRevealStepUpAction({
          method: "passkey",
          target,
        });
        if (!beginResult.success) {
          const message = t(beginResult.errorKey);
          setSecretRevealStepUpError(message);
          setTargetRevealError(target, message);
          return;
        }
        const passkeyResult = await authClient.signIn.passkey();
        if (passkeyResult.error) {
          const message = t("error_step_up_failed");
          setSecretRevealStepUpError(message);
          setTargetRevealError(target, message);
          return;
        }
        const completeResult = await completeSecretRevealStepUpAction({
          target,
        });
        if (!completeResult.success) {
          const message = t(completeResult.errorKey);
          setSecretRevealStepUpError(message);
          setTargetRevealError(target, message);
          return;
        }
        await revealSecretAfterStepUp(target);
      } catch (error: unknown) {
        if (reloadIfServerActionStale(error)) {
          return;
        }
        const message = t("error_step_up_failed");
        setSecretRevealStepUpError(message);
        setTargetRevealError(target, message);
      } finally {
        setSecretRevealPendingMethod(null);
      }
    });
  };

  const handleSocialStepUp = (
    target: SecretRevealTarget,
    provider: SecretRevealSocialProvider,
  ) => {
    const startTransition =
      target === "mail_password"
        ? startMailPasswordRevealTransition
        : startAppriseUrlRevealTransition;
    startTransition(async () => {
      setSecretRevealPendingMethod(provider);
      setSecretRevealStepUpError("");
      try {
        const beginResult = await beginSecretRevealStepUpAction({
          method: "social",
          provider,
          target,
        });
        if (!beginResult.success) {
          const message = t(beginResult.errorKey);
          setSecretRevealStepUpError(message);
          setTargetRevealError(target, message);
          return;
        }
        if (typeof window !== "undefined") {
          window.sessionStorage.setItem(
            SECRET_REVEAL_TARGET_STORAGE_KEY,
            target,
          );
        }
        const callbackURL =
          typeof window === "undefined"
            ? "/test?secretRevealStepUp=1"
            : buildSecretRevealCallbackUrl(window.location.pathname);
        const socialResult = await authClient.signIn.social({
          provider,
          callbackURL,
        });
        if (socialResult?.error) {
          const message = t("error_step_up_failed");
          setSecretRevealStepUpError(message);
          setTargetRevealError(target, message);
          setSecretRevealPendingMethod(null);
        }
      } catch (error: unknown) {
        if (reloadIfServerActionStale(error)) {
          return;
        }
        const message = t("error_step_up_failed");
        setSecretRevealStepUpError(message);
        setTargetRevealError(target, message);
        setSecretRevealPendingMethod(null);
      }
    });
  };

  const handleAppriseUrlToggle = (
    revealMode: "none" | "external_click" | "password_confirm",
  ) => {
    if (revealedAppriseUrl !== null) {
      setRevealedAppriseUrl(null);
      return;
    }

    if (revealMode === "external_click") {
      startAppriseUrlRevealTransition(async () => {
        try {
          const result = await revealAppriseUrlAction();
          handleAppriseUrlRevealResult(result);
        } catch (error: unknown) {
          if (reloadIfServerActionStale(error)) {
            return;
          }
          toast({
            title: t("toast_error_title"),
            description: t("error_reveal_failed"),
            variant: "destructive",
          });
        }
      });
      return;
    }

    if (revealMode === "password_confirm") {
      openSecretRevealDialog("apprise_url");
    }
  };

  const handleConfirmAppriseUrlReveal = () => {
    setAppriseUrlRevealError("");
    startAppriseUrlRevealTransition(async () => {
      try {
        const result = await revealAppriseUrlAction({
          currentPassword: appriseUrlConfirmValue,
        });
        handleAppriseUrlRevealResult(result);
      } catch (error: unknown) {
        if (reloadIfServerActionStale(error)) {
          return;
        }
        setAppriseUrlRevealError(t("error_reveal_failed"));
        toast({
          title: t("toast_error_title"),
          description: t("error_reveal_failed"),
          variant: "destructive",
        });
      }
    });
  };

  const consumeSocialReauthCallback = React.useEffectEvent(
    (target: SecretRevealTarget) => {
      const startTransition =
        target === "mail_password"
          ? startMailPasswordRevealTransition
          : startAppriseUrlRevealTransition;
      startTransition(async () => {
        setSecretRevealPendingMethod("social");
        try {
          const completeResult = await completeSecretRevealStepUpAction({
            target,
          });
          if (!completeResult.success) {
            const message = t(completeResult.errorKey);
            setSecretRevealStepUpError(message);
            setTargetRevealError(target, message);
            toast({
              title: t("toast_error_title"),
              description: message,
              variant: "destructive",
            });
            return;
          }
          await revealSecretAfterStepUp(target);
        } catch (error: unknown) {
          if (reloadIfServerActionStale(error)) {
            return;
          }
          const message = t("error_step_up_failed");
          setSecretRevealStepUpError(message);
          setTargetRevealError(target, message);
          toast({
            title: t("toast_error_title"),
            description: message,
            variant: "destructive",
          });
        } finally {
          setSecretRevealPendingMethod(null);
        }
      });
    },
  );

  // Runs once after social re-auth redirects back to the diagnostics page.
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("secretRevealStepUp") !== "1") return;

    const target = getSecretRevealTargetFromSessionStorage(
      window.sessionStorage,
    );
    url.searchParams.delete("secretRevealStepUp");
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);

    consumeSocialReauthCallback(target);
  }, []);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <GithubBrandIcon className="size-8 text-muted-foreground" />
            <div>
              <CardTitle>{t("github_card_title")}</CardTitle>
              <CardDescription>{t("github_card_description")}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <StatusIndicator
            status={isTokenSet ? "success" : "warning"}
            text={isTokenSet ? t("token_set") : t("token_not_set")}
          />
          {!isTokenSet && (
            <p className="pl-7 text-sm text-muted-foreground">
              {t("token_advice")}
            </p>
          )}

          {rateLimitData ? (
            <div>
              <StatusIndicator
                status={isRateLimitHigh ? "success" : "warning"}
                text={
                  isRateLimitHigh
                    ? t("auth_access_confirmed")
                    : t("unauth_access")
                }
              />
              <div className="mt-2 pl-7 text-sm text-muted-foreground space-y-1">
                <p>{t("api_limit", { limit: rateLimit?.limit ?? 0 })}</p>
                <p>
                  {t("api_remaining", {
                    remaining: rateLimit?.remaining ?? 0,
                  })}
                </p>
                <p>{t("api_resets", { time: resetTime })}</p>
              </div>
            </div>
          ) : (
            <StatusIndicator
              status="error"
              text={t(
                rateLimitError === "invalid_token"
                  ? "invalid_token_error"
                  : "rate_limit_fail",
              )}
            />
          )}
          {isTokenSet && rateLimitError === "invalid_token" && (
            <p className="pl-7 text-sm text-muted-foreground">
              {t("invalid_token_advice")}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <GitlabBrandIcon className="size-8 text-muted-foreground" />
            <div>
              <CardTitle>{t("gitlab_card_title")}</CardTitle>
              <CardDescription>{t("gitlab_card_description")}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <StatusIndicator
            status={gitlabTokenStatus}
            text={gitlabTokenStatusText}
          />
          {gitlabTokenCheck.status === "not_set" && (
            <p className="pl-7 text-sm text-muted-foreground">
              {t("gitlab_token_advice")}
            </p>
          )}
          <div>
            <StatusIndicator
              status={gitlabAuthStatus.status}
              text={gitlabAuthStatus.text}
            />
            <div className="mt-2 pl-7 text-sm text-muted-foreground space-y-1">
              {gitlabDetails}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <CodebergBrandIcon className="size-8 text-muted-foreground" />
            <div>
              <CardTitle>{t("codeberg_card_title")}</CardTitle>
              <CardDescription>
                {t("codeberg_card_description")}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <StatusIndicator
            status={codebergTokenStatus}
            text={codebergTokenStatusText}
          />
          {codebergTokenCheck.status === "not_set" && (
            <p className="pl-7 text-sm text-muted-foreground">
              {t("codeberg_token_advice")}
            </p>
          )}
          <div>
            <StatusIndicator
              status={codebergAuthStatus.status}
              text={codebergAuthStatus.text}
            />
            <div className="mt-2 pl-7 text-sm text-muted-foreground space-y-1">
              {codebergDetails}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <RefreshCw className="size-8 text-muted-foreground" />
            <div>
              <CardTitle>{t("update_card_title")}</CardTitle>
              <CardDescription>{t("update_card_description")}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <StatusIndicator
            status={updateStatus.status}
            text={updateStatus.text}
          />
          <div className="pl-7 text-sm text-muted-foreground space-y-1">
            <p>
              {t("update_current_version", {
                version: updateNotice.currentVersion,
              })}
            </p>
            <p>{formattedLastChecked}</p>
            <p>{latestVersionText}</p>
          </div>
          <div className="flex items-center pt-2">
            <Button
              onClick={handleManualUpdateCheck}
              disabled={isCheckingUpdate || !isOnline}
              size="sm"
            >
              {isCheckingUpdate ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              <span>{t("update_button_label")}</span>
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Bell className="size-8 text-muted-foreground" />
            <div>
              <CardTitle>{t("apprise_card_title")}</CardTitle>
              <CardDescription>{t("apprise_card_description")}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {appriseStatus.status === "not_configured" ? (
            <StatusIndicator
              status="warning"
              text={t("apprise_not_configured")}
            />
          ) : appriseStatus.status === "ok" ? (
            <StatusIndicator status="success" text={t("apprise_ok")} />
          ) : (
            <div>
              <StatusIndicator status="error" text={t("apprise_error")} />
              <p className="pl-7 text-sm text-muted-foreground">
                {appriseStatus.error}
              </p>
            </div>
          )}

          {revealedAppriseUrl !== null && (
            <div className="flex items-center gap-2 rounded-lg border border-yellow-500/50 bg-yellow-500/10 p-3 text-sm text-yellow-300">
              <AlertTriangle className="size-5 shrink-0" />
              <p>{t("apprise_url_warning")}</p>
            </div>
          )}
          <div className="pl-7 flex items-center gap-2">
            <p className="grow break-all font-mono text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">
                APPRISE_URL=
              </span>
              {appriseUrlVariable?.isSet &&
              (revealedAppriseUrl || appriseUrlVariable.displayValue) ? (
                <span>
                  {revealedAppriseUrl ?? appriseUrlVariable.displayValue}
                </span>
              ) : (
                <span className="italic">{t("email_not_set")}</span>
              )}
            </p>
            {appriseUrlVariable?.isSet &&
              appriseUrlVariable.revealMode !== "none" && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  disabled={isRevealingAppriseUrl}
                  onClick={() =>
                    handleAppriseUrlToggle(appriseUrlVariable.revealMode)
                  }
                  aria-label={t(
                    revealedAppriseUrl ? "hide_secret" : "show_secret",
                  )}
                >
                  {isRevealingAppriseUrl ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : revealedAppriseUrl ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </Button>
              )}
          </div>
          <div className="flex flex-col items-start gap-4 pt-2">
            <Button
              onClick={handleRefreshAppriseStatus}
              disabled={
                isCheckingApprise ||
                appriseStatus.status === "not_configured" ||
                !isOnline
              }
              variant="outline"
              size="sm"
            >
              {isCheckingApprise ? (
                <Loader2 className="animate-spin" />
              ) : (
                <RefreshCw />
              )}
              <span>{t("apprise_refresh_status_button")}</span>
            </Button>
            <Button
              onClick={handleSendTestApprise}
              disabled={
                isSendingApprise || appriseStatus.status !== "ok" || !isOnline
              }
              size="sm"
            >
              {isSendingApprise ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Bell />
              )}
              <span>{t("send_test_apprise_button")}</span>
            </Button>
          </div>
          <SecretRevealDialog
            target="apprise_url"
            open={appriseUrlDialogOpen}
            onOpenChange={(open) =>
              handleSecretRevealDialogOpenChange("apprise_url", open)
            }
            methods={secretRevealMethods}
            optionsLoading={secretRevealOptionsLoading}
            totpCode={secretRevealTotpCode}
            onTotpCodeChange={setSecretRevealTotpCode}
            stepUpError={secretRevealStepUpError}
            pendingMethod={secretRevealPendingMethod}
            isRevealing={isRevealingAppriseUrl}
            confirmValue={appriseUrlConfirmValue}
            onConfirmValueChange={setAppriseUrlConfirmValue}
            revealError={appriseUrlRevealError}
            onConfirm={handleConfirmAppriseUrlReveal}
            onTotp={() => handleTotpStepUp("apprise_url")}
            onPasskey={() => handlePasskeyStepUp("apprise_url")}
            onSocial={(provider) => handleSocialStepUp("apprise_url", provider)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Mail className="size-8 text-muted-foreground" />
            <div>
              <CardTitle>{t("email_card_title")}</CardTitle>
              <CardDescription>{t("email_card_description")}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <StatusIndicator
            status={notificationConfig.isSmtpConfigured ? "success" : "warning"}
            text={
              notificationConfig.isSmtpConfigured
                ? t("email_configured")
                : t("email_not_configured")
            }
          />

          <div className="pl-7 pt-4 border-t space-y-3">
            <h4 className="font-semibold text-sm">
              {t("email_all_variables_title")}
            </h4>

            {revealedMailPassword !== null && (
              <div className="flex items-center gap-2 rounded-lg border border-yellow-500/50 bg-yellow-500/10 p-3 text-sm text-yellow-300">
                <AlertTriangle className="size-5 shrink-0" />
                <p>{t("email_password_warning")}</p>
              </div>
            )}
            <div className="text-sm text-muted-foreground font-mono space-y-2 break-all">
              {notificationConfig.variables.map((variable) => {
                if (variable.key === "APPRISE_URL") return null;
                const isMissingAndRequired =
                  variable.isRequired && !variable.isSet;

                if (variable.key === "MAIL_PASSWORD" && variable.isSet) {
                  const isRevealed = revealedMailPassword !== null;
                  const canReveal = variable.revealMode !== "none";
                  return (
                    <div key={variable.key} className="flex items-center gap-2">
                      <p className="grow">
                        <span className="font-semibold text-foreground">
                          {variable.key}=
                        </span>
                        <span>
                          {isRevealed
                            ? revealedMailPassword
                            : (variable.displayValue ?? "••••••••")}
                        </span>
                      </p>
                      {canReveal && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          disabled={isRevealingMailPassword}
                          onClick={() =>
                            handleMailPasswordToggle(variable.revealMode)
                          }
                          aria-label={t(
                            isRevealed ? "hide_password" : "show_password",
                          )}
                        >
                          {isRevealingMailPassword ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : isRevealed ? (
                            <EyeOff className="size-4" />
                          ) : (
                            <Eye className="size-4" />
                          )}
                        </Button>
                      )}
                    </div>
                  );
                }

                return (
                  <p key={variable.key}>
                    <span className="font-semibold text-foreground">
                      {variable.key}=
                    </span>
                    {variable.isSet && variable.displayValue ? (
                      <span>{variable.displayValue}</span>
                    ) : (
                      <span
                        className={`italic ${
                          isMissingAndRequired ? "text-yellow-500" : ""
                        }`}
                      >
                        {t("email_not_set")}
                      </span>
                    )}
                  </p>
                );
              })}
            </div>
          </div>

          <SecretRevealDialog
            target="mail_password"
            open={mailPasswordDialogOpen}
            onOpenChange={(open) =>
              handleSecretRevealDialogOpenChange("mail_password", open)
            }
            methods={secretRevealMethods}
            optionsLoading={secretRevealOptionsLoading}
            totpCode={secretRevealTotpCode}
            onTotpCodeChange={setSecretRevealTotpCode}
            stepUpError={secretRevealStepUpError}
            pendingMethod={secretRevealPendingMethod}
            isRevealing={isRevealingMailPassword}
            confirmValue={mailPasswordConfirmValue}
            onConfirmValueChange={setMailPasswordConfirmValue}
            revealError={mailPasswordRevealError}
            onConfirm={handleConfirmMailPasswordReveal}
            onTotp={() => handleTotpStepUp("mail_password")}
            onPasskey={() => handlePasskeyStepUp("mail_password")}
            onSocial={(provider) =>
              handleSocialStepUp("mail_password", provider)
            }
          />

          <div className="pt-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor={emailInputId}>{t("email_recipient_label")}</Label>
              <Input
                id={emailInputId}
                type="email"
                placeholder={t("email_recipient_placeholder")}
                value={customEmail}
                onChange={handleEmailChange}
                disabled={isSendingMail || !notificationConfig.isSmtpConfigured}
                className={cn(
                  isEmailInvalid &&
                    "border-destructive focus-visible:ring-destructive",
                )}
              />
              {isEmailInvalid && (
                <p className="text-sm text-destructive">
                  {t("invalid_email_format")}
                </p>
              )}
            </div>
            <div>
              <Button
                onClick={handleSendTestEmail}
                disabled={
                  isSendingMail ||
                  !notificationConfig.isSmtpConfigured ||
                  isEmailInvalid ||
                  !isOnline
                }
              >
                {isSendingMail ? (
                  <Loader2 className="mr-2 animate-spin" />
                ) : (
                  <Mail className="mr-2" />
                )}
                {t("send_test_email_button")}
              </Button>
              {!notificationConfig.isSmtpConfigured && (
                <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                  <AlertTriangle className="size-4 shrink-0" />
                  <span>{t("email_config_required_tooltip")}</span>
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Workflow className="size-8 text-muted-foreground" />
            <div>
              <CardTitle>{t("notification_card_title")}</CardTitle>
              <CardDescription>
                {t("notification_card_description")}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3">
            <h4 className="font-semibold">{t("e2e_step1_title")}</h4>
            <p className="text-sm text-muted-foreground">
              {t("e2e_step1_description")}
            </p>
            <Button
              onClick={handleSetupTestRepo}
              disabled={isSettingUpRepo || !isOnline}
            >
              {isSettingUpRepo ? (
                <Loader2 className="mr-2 animate-spin" />
              ) : (
                <PackagePlus className="mr-2" />
              )}
              {t("setup_test_repo_button")}
            </Button>
          </div>
          <div className="space-y-3">
            <h4 className="font-semibold">{t("e2e_step2_title")}</h4>
            <p className="text-sm text-muted-foreground">
              {t("e2e_step2_description")}
            </p>
            <div>
              <Button
                onClick={handleTriggerReleaseCheck}
                disabled={
                  isTriggeringCheck ||
                  (!notificationConfig.isSmtpConfigured &&
                    !notificationConfig.isAppriseConfigured) ||
                  !isOnline
                }
              >
                {isTriggeringCheck ? (
                  <Loader2 className="mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2" />
                )}
                {t("trigger_check_button")}
              </Button>
              {!notificationConfig.isSmtpConfigured &&
                !notificationConfig.isAppriseConfigured && (
                  <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                    <AlertTriangle className="size-4 shrink-0" />
                    <span>{t("notification_config_required_tooltip")}</span>
                  </p>
                )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
