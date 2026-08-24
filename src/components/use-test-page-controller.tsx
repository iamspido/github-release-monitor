"use client";

import { useLocale, useTranslations } from "next-intl";
import * as React from "react";
import {
  beginSecretRevealStepUpAction,
  completeSecretRevealStepUpAction,
  getSecretRevealOptionsAction,
  revealAppriseUrlAction,
  revealMailPasswordAction,
  verifySecretRevealTotpAction,
} from "@/app/actions";
import {
  buildSecretRevealCallbackUrl,
  getSecretRevealTargetFromSessionStorage,
  SECRET_REVEAL_TARGET_STORAGE_KEY,
  type SecretRevealMethods,
  type SecretRevealSocialProvider,
  type SecretRevealTarget,
} from "@/components/diagnostics/secret-reveal-model";
import { useBrowserTimeZone } from "@/hooks/use-browser-time-zone";
import { useDiagnosticsActions } from "@/hooks/use-diagnostics-actions";
import { useNetworkStatus } from "@/hooks/use-network";
import { useToast } from "@/hooks/use-toast";
import { authClient } from "@/lib/auth/client";
import { isolateLtrText } from "@/lib/bidi";
import { formatAbsoluteDateTime } from "@/lib/date-time";
import { reloadIfServerActionStale } from "@/lib/server-action-error";
import type {
  AppriseStatus,
  CodebergTokenCheckResult,
  ForgejoTokenCheckResult,
  GitlabTokenCheckResult,
  NotificationConfig,
  RateLimitResult,
  TimeFormat,
  UpdateNotificationState,
} from "@/types";

export interface TestPageClientProps {
  rateLimitResult: RateLimitResult;
  isTokenSet: boolean;
  gitlabTokenCheck: GitlabTokenCheckResult;
  codebergTokenCheck: CodebergTokenCheckResult;
  forgejoTokenChecks: ForgejoTokenCheckResult[];
  notificationConfig: NotificationConfig;
  appriseStatus: AppriseStatus;
  updateNotice: UpdateNotificationState;
  timeFormat: TimeFormat;
}

export function useTestPageController({
  rateLimitResult,
  gitlabTokenCheck,
  codebergTokenCheck,
  notificationConfig,
  appriseStatus: initialAppriseStatus,
  updateNotice: initialUpdateNotice,
  timeFormat,
}: TestPageClientProps) {
  const t = useTranslations("TestPage");
  const locale = useLocale();
  const browserTimeZone = useBrowserTimeZone();
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
  const [formattedLastChecked, setFormattedLastChecked] = React.useState(() =>
    updateNotice.lastCheckedAt
      ? t("update_last_checked", { time: t("not_available") })
      : t("update_last_checked_never"),
  );
  React.useEffect(() => {
    if (!updateNotice.lastCheckedAt) {
      setFormattedLastChecked(t("update_last_checked_never"));
      return;
    }

    const date = new Date(updateNotice.lastCheckedAt);
    if (Number.isNaN(date.getTime())) {
      setFormattedLastChecked(
        t("update_last_checked", { time: t("not_available") }),
      );
      return;
    }
    if (!browserTimeZone) {
      setFormattedLastChecked(
        t("update_last_checked", { time: t("not_available") }),
      );
      return;
    }

    setFormattedLastChecked(
      t("update_last_checked", {
        time: formatAbsoluteDateTime(date, {
          locale,
          timeFormat,
          timeZone: browserTimeZone,
          format: {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          },
        }),
      }),
    );
  }, [browserTimeZone, locale, timeFormat, updateNotice.lastCheckedAt, t]);

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
          version: updateNotice.latestVersion
            ? isolateLtrText(updateNotice.latestVersion)
            : t("not_available"),
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
    ? t("update_latest_known", {
        version: isolateLtrText(updateNotice.latestVersion),
      })
    : t("update_latest_known_none");

  React.useEffect(() => {
    if (rateLimit && browserTimeZone) {
      setResetTime(
        formatAbsoluteDateTime(new Date(rateLimit.reset * 1000), {
          locale,
          timeFormat,
          timeZone: browserTimeZone,
          format: {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          },
        }),
      );
    }
  }, [browserTimeZone, locale, rateLimit, timeFormat]);

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

  return {
    appriseStatus,
    appriseUrlConfirmValue,
    appriseUrlDialogOpen,
    appriseUrlRevealError,
    appriseUrlVariable,
    codebergAuthStatus,
    codebergDetails,
    codebergTokenStatus,
    codebergTokenStatusText,
    customEmail,
    emailInputId,
    formattedLastChecked,
    gitlabAuthStatus,
    gitlabDetails,
    gitlabTokenStatus,
    gitlabTokenStatusText,
    handleAppriseUrlToggle,
    handleConfirmAppriseUrlReveal,
    handleConfirmMailPasswordReveal,
    handleEmailChange,
    handleMailPasswordToggle,
    handleManualUpdateCheck,
    handlePasskeyStepUp,
    handleRefreshAppriseStatus,
    handleSecretRevealDialogOpenChange,
    handleSendTestApprise,
    handleSendTestEmail,
    handleSetupTestRepo,
    handleSocialStepUp,
    handleTotpStepUp,
    handleTriggerReleaseCheck,
    isCheckingApprise,
    isCheckingUpdate,
    isEmailInvalid,
    isOnline,
    isRateLimitHigh,
    isRevealingAppriseUrl,
    isRevealingMailPassword,
    isSendingApprise,
    isSendingMail,
    isSettingUpRepo,
    isTriggeringCheck,
    latestVersionText,
    mailPasswordConfirmValue,
    mailPasswordDialogOpen,
    mailPasswordRevealError,
    rateLimit,
    rateLimitData,
    rateLimitError,
    resetTime,
    revealedAppriseUrl,
    revealedMailPassword,
    secretRevealMethods,
    secretRevealOptionsLoading,
    secretRevealPendingMethod,
    secretRevealStepUpError,
    secretRevealTotpCode,
    setAppriseUrlConfirmValue,
    setMailPasswordConfirmValue,
    setSecretRevealTotpCode,
    updateNotice,
    updateStatus,
  };
}

export type TestPageController = ReturnType<typeof useTestPageController>;
