"use client";

import { format } from "date-fns";
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Eye,
  EyeOff,
  Fingerprint,
  KeyRound,
  Loader2,
  Mail,
  PackagePlus,
  RefreshCw,
  ShieldCheck,
  Workflow,
  XCircle,
} from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";

import {
  beginSecretRevealStepUpAction,
  checkAppriseStatusAction,
  completeSecretRevealStepUpAction,
  getSecretRevealOptionsAction,
  revealAppriseUrlAction,
  revealMailPasswordAction,
  sendTestAppriseAction,
  sendTestEmailAction,
  setupTestRepositoryAction,
  triggerAppUpdateCheckAction,
  triggerReleaseCheckAction,
  verifySecretRevealTotpAction,
} from "@/app/actions";
import { GoogleBrandIcon } from "@/components/google-brand-icon";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

type SecretRevealTarget = "mail_password" | "apprise_url";
type SecretRevealSocialProvider = "github" | "google";
type SecretRevealMethods = {
  password: boolean;
  totp: boolean;
  passkey: boolean;
  socialProviders: SecretRevealSocialProvider[];
};

const SECRET_REVEAL_TARGET_STORAGE_KEY = "diagnosticSecretRevealTarget";

function StatusIndicator({
  status,
  text,
}: {
  status: "success" | "warning" | "error";
  text: string;
}) {
  const icons = {
    success: CheckCircle2,
    warning: AlertTriangle,
    error: XCircle,
  };
  const colors = {
    success: "text-green-500",
    warning: "text-yellow-500",
    error: "text-destructive",
  };

  const Icon = icons[status];
  const color = colors[status];

  return (
    <div className="flex items-center gap-2">
      <Icon className={`size-5 shrink-0 ${color}`} />
      <span className="font-medium">{text}</span>
    </div>
  );
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
  const [isSendingMail, startMailTransition] = React.useTransition();
  const [isSettingUpRepo, startSetupRepoTransition] = React.useTransition();
  const [isTriggeringCheck, startTriggerCheckTransition] =
    React.useTransition();
  const [isSendingApprise, startAppriseTransition] = React.useTransition();
  const [isCheckingApprise, startAppriseCheckTransition] =
    React.useTransition();
  const [isCheckingUpdate, startUpdateTransition] = React.useTransition();
  const [isRevealingMailPassword, startMailPasswordRevealTransition] =
    React.useTransition();
  const [isRevealingAppriseUrl, startAppriseUrlRevealTransition] =
    React.useTransition();

  const { toast } = useToast();
  const [resetTime, setResetTime] = React.useState(t("not_available"));
  const [customEmail, setCustomEmail] = React.useState("");
  const [isEmailInvalid, setIsEmailInvalid] = React.useState(false);
  const [appriseStatus, setAppriseStatus] =
    React.useState(initialAppriseStatus);
  const [updateNotice, setUpdateNotice] = React.useState(initialUpdateNotice);
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
  const mailPasswordConfirmInputId = React.useId();
  const appriseUrlConfirmInputId = React.useId();
  const secretRevealTotpInputId = React.useId();

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

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const email = e.target.value;
    setCustomEmail(email);
    if (email.trim().length > 0) {
      // Basic regex for email format validation
      const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      setIsEmailInvalid(!isValid);
    } else {
      setIsEmailInvalid(false); // Clear error if the field is empty
    }
  };

  const handleSendTestEmail = () => {
    if (isEmailInvalid) return;

    startMailTransition(async () => {
      try {
        const result = await sendTestEmailAction(customEmail);
        if (result.success) {
          toast({
            title: t("toast_email_success_title"),
            description: t("toast_email_success_description"),
          });
        } else {
          toast({
            title: t("toast_email_error_title"),
            description: result.error || t("toast_email_error_description"),
            variant: "destructive",
          });
        }
      } catch (error: unknown) {
        if (reloadIfServerActionStale(error)) {
          return;
        }
        toast({
          title: t("toast_email_error_title"),
          description: t("toast_email_error_description"),
          variant: "destructive",
        });
      }
    });
  };

  const handleSendTestApprise = () => {
    startAppriseTransition(async () => {
      try {
        const result = await sendTestAppriseAction();
        if (result.success) {
          toast({
            title: t("toast_apprise_success_title"),
            description: t("toast_apprise_success_description"),
          });
        } else {
          toast({
            title: t("toast_apprise_error_title"),
            description: result.error,
            variant: "destructive",
          });
        }
      } catch (error: unknown) {
        if (reloadIfServerActionStale(error)) {
          return;
        }
        toast({
          title: t("toast_apprise_error_title"),
          description: t("toast_apprise_not_configured_error"),
          variant: "destructive",
        });
      }
    });
  };

  const handleManualUpdateCheck = () => {
    startUpdateTransition(async () => {
      try {
        const result = await triggerAppUpdateCheckAction();
        setUpdateNotice(result.notice);

        if (result.notice.lastCheckError) {
          toast({
            title: t("toast_error_title"),
            description: t("toast_update_error_description", {
              error: result.notice.lastCheckError,
            }),
            variant: "destructive",
          });
          return;
        }

        if (result.notice.shouldNotify) {
          toast({
            title: t("toast_success_title"),
            description: t("toast_update_available_description", {
              version: result.notice.latestVersion ?? t("not_available"),
            }),
          });
        } else {
          toast({
            title: t("toast_success_title"),
            description: t("toast_update_not_available_description"),
          });
        }
      } catch (error: unknown) {
        if (reloadIfServerActionStale(error)) {
          return;
        }
        const errorMessage =
          error instanceof Error ? error.message : String(error ?? "unknown");
        toast({
          title: t("toast_error_title"),
          description: t("toast_update_error_description", {
            error: errorMessage,
          }),
          variant: "destructive",
        });
      }
    });
  };

  const handleSetupTestRepo = () => {
    startSetupRepoTransition(async () => {
      try {
        const result = await setupTestRepositoryAction();
        toast({
          title: result.success
            ? t("toast_success_title")
            : t("toast_error_title"),
          description: result.message,
          variant: result.success ? "default" : "destructive",
        });
      } catch (error: unknown) {
        if (reloadIfServerActionStale(error)) {
          return;
        }
        toast({
          title: t("toast_error_title"),
          description: t("toast_setup_test_repo_error"),
          variant: "destructive",
        });
      }
    });
  };

  const handleTriggerReleaseCheck = () => {
    startTriggerCheckTransition(async () => {
      try {
        const result = await triggerReleaseCheckAction();
        toast({
          title: result.success
            ? t("toast_success_title")
            : t("toast_error_title"),
          description: result.message,
          variant: result.success ? "default" : "destructive",
        });
      } catch (error: unknown) {
        if (reloadIfServerActionStale(error)) {
          return;
        }
        toast({
          title: t("toast_error_title"),
          description: t("toast_trigger_check_error"),
          variant: "destructive",
        });
      }
    });
  };

  const handleRefreshAppriseStatus = () => {
    startAppriseCheckTransition(async () => {
      try {
        const status = await checkAppriseStatusAction();
        setAppriseStatus(status);
      } catch (error: unknown) {
        if (reloadIfServerActionStale(error)) {
          return;
        }
        // Keep previous state, just inform user.
        toast({
          title: t("toast_error_title"),
          description: t("apprise_error"),
          variant: "destructive",
        });
      }
    });
  };

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
        const completeResult = await completeSecretRevealStepUpAction();
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
            : `${window.location.pathname}?secretRevealStepUp=1`;
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

  // Runs once after social re-auth redirects back to the diagnostics page.
  // biome-ignore lint/correctness/useExhaustiveDependencies: This must only consume the callback URL once.
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("secretRevealStepUp") !== "1") return;

    const storedTarget = window.sessionStorage.getItem(
      SECRET_REVEAL_TARGET_STORAGE_KEY,
    );
    const target: SecretRevealTarget =
      storedTarget === "apprise_url" ? "apprise_url" : "mail_password";
    window.sessionStorage.removeItem(SECRET_REVEAL_TARGET_STORAGE_KEY);
    url.searchParams.delete("secretRevealStepUp");
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);

    const startTransition =
      target === "mail_password"
        ? startMailPasswordRevealTransition
        : startAppriseUrlRevealTransition;
    startTransition(async () => {
      setSecretRevealPendingMethod("social");
      try {
        const completeResult = await completeSecretRevealStepUpAction();
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
  }, []);

  const renderSecretRevealStepUpOptions = (target: SecretRevealTarget) => {
    const isPending = Boolean(secretRevealPendingMethod);
    const methods = secretRevealMethods;
    const providerLabel: Record<SecretRevealSocialProvider, string> = {
      github: "GitHub",
      google: "Google",
    };

    return (
      <div className="space-y-3 border-t pt-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <KeyRound className="size-4" />
          <span>{t("secret_reveal_alternatives_title")}</span>
        </div>
        {secretRevealOptionsLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            <span>{t("secret_reveal_options_loading")}</span>
          </div>
        ) : (
          <div className="space-y-3">
            {methods?.totp && (
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  id={secretRevealTotpInputId}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={secretRevealTotpCode}
                  onChange={(event) =>
                    setSecretRevealTotpCode(event.target.value)
                  }
                  placeholder={t("secret_reveal_totp_placeholder")}
                  disabled={isPending}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleTotpStepUp(target)}
                  disabled={isPending || !secretRevealTotpCode.trim()}
                >
                  {secretRevealPendingMethod === "totp" ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <ShieldCheck />
                  )}
                  <span>{t("secret_reveal_totp_button")}</span>
                </Button>
              </div>
            )}
            {methods?.passkey && (
              <Button
                type="button"
                variant="outline"
                className="w-full justify-start"
                onClick={() => handlePasskeyStepUp(target)}
                disabled={isPending}
              >
                {secretRevealPendingMethod === "passkey" ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Fingerprint />
                )}
                <span>{t("secret_reveal_passkey_button")}</span>
              </Button>
            )}
            {methods?.socialProviders.map((provider) => (
              <Button
                key={provider}
                type="button"
                variant="outline"
                className="w-full justify-start"
                onClick={() => handleSocialStepUp(target, provider)}
                disabled={isPending}
              >
                {secretRevealPendingMethod === provider ? (
                  <Loader2 className="animate-spin" />
                ) : provider === "github" ? (
                  <GithubBrandIcon className="size-4" />
                ) : (
                  <GoogleBrandIcon className="size-4" />
                )}
                <span>
                  {t("secret_reveal_social_button", {
                    provider: providerLabel[provider],
                  })}
                </span>
              </Button>
            ))}
            {methods &&
              !methods.totp &&
              !methods.passkey &&
              methods.socialProviders.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {t("secret_reveal_no_alternatives")}
                </p>
              )}
          </div>
        )}
        {secretRevealStepUpError && (
          <p className="text-sm text-destructive">{secretRevealStepUpError}</p>
        )}
      </div>
    );
  };

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
          <Dialog
            open={appriseUrlDialogOpen}
            onOpenChange={(open) => {
              setAppriseUrlDialogOpen(open);
              if (!open) {
                setAppriseUrlConfirmValue("");
                setAppriseUrlRevealError("");
                setSecretRevealTotpCode("");
                setSecretRevealStepUpError("");
                setSecretRevealPendingMethod(null);
              }
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t("apprise_url_reveal_title")}</DialogTitle>
                <DialogDescription>
                  {t("apprise_url_reveal_description")}
                </DialogDescription>
              </DialogHeader>
              {(secretRevealMethods?.password ?? true) && (
                <div className="space-y-2">
                  <Label htmlFor={appriseUrlConfirmInputId}>
                    {t("mail_password_current_password_label")}
                  </Label>
                  <Input
                    id={appriseUrlConfirmInputId}
                    type="password"
                    value={appriseUrlConfirmValue}
                    onChange={(event) =>
                      setAppriseUrlConfirmValue(event.target.value)
                    }
                    disabled={isRevealingAppriseUrl}
                    autoComplete="current-password"
                  />
                  {appriseUrlRevealError && (
                    <p className="text-sm text-destructive">
                      {appriseUrlRevealError}
                    </p>
                  )}
                </div>
              )}
              {renderSecretRevealStepUpOptions("apprise_url")}
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setAppriseUrlDialogOpen(false)}
                  disabled={isRevealingAppriseUrl}
                >
                  {t("cancel")}
                </Button>
                <Button
                  type="button"
                  onClick={handleConfirmAppriseUrlReveal}
                  disabled={
                    isRevealingAppriseUrl ||
                    !appriseUrlConfirmValue ||
                    secretRevealMethods?.password === false
                  }
                >
                  {isRevealingAppriseUrl && (
                    <Loader2 className="animate-spin" />
                  )}
                  {t("apprise_url_reveal_button")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
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

          <Dialog
            open={mailPasswordDialogOpen}
            onOpenChange={(open) => {
              setMailPasswordDialogOpen(open);
              if (!open) {
                setMailPasswordConfirmValue("");
                setMailPasswordRevealError("");
                setSecretRevealTotpCode("");
                setSecretRevealStepUpError("");
                setSecretRevealPendingMethod(null);
              }
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t("mail_password_reveal_title")}</DialogTitle>
                <DialogDescription>
                  {t("mail_password_reveal_description")}
                </DialogDescription>
              </DialogHeader>
              {(secretRevealMethods?.password ?? true) && (
                <div className="space-y-2">
                  <Label htmlFor={mailPasswordConfirmInputId}>
                    {t("mail_password_current_password_label")}
                  </Label>
                  <Input
                    id={mailPasswordConfirmInputId}
                    type="password"
                    value={mailPasswordConfirmValue}
                    onChange={(event) =>
                      setMailPasswordConfirmValue(event.target.value)
                    }
                    disabled={isRevealingMailPassword}
                    autoComplete="current-password"
                  />
                  {mailPasswordRevealError && (
                    <p className="text-sm text-destructive">
                      {mailPasswordRevealError}
                    </p>
                  )}
                </div>
              )}
              {renderSecretRevealStepUpOptions("mail_password")}
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setMailPasswordDialogOpen(false)}
                  disabled={isRevealingMailPassword}
                >
                  {t("cancel")}
                </Button>
                <Button
                  type="button"
                  onClick={handleConfirmMailPasswordReveal}
                  disabled={
                    isRevealingMailPassword ||
                    !mailPasswordConfirmValue ||
                    secretRevealMethods?.password === false
                  }
                >
                  {isRevealingMailPassword && (
                    <Loader2 className="animate-spin" />
                  )}
                  {t("mail_password_reveal_button")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

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
