"use client";

import { format } from "date-fns";
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Eye,
  EyeOff,
  Github,
  Loader2,
  Mail,
  PackagePlus,
  RefreshCw,
  Workflow,
  XCircle,
} from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";

import {
  checkAppriseStatusAction,
  sendTestAppriseAction,
  sendTestEmailAction,
  setupTestRepositoryAction,
  triggerAppUpdateCheckAction,
  triggerReleaseCheckAction,
} from "@/app/actions";
import { CodebergIcon } from "@/components/icons/codeberg-icon";
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
import { useNetworkStatus } from "@/hooks/use-network";
import { useToast } from "@/hooks/use-toast";
import { reloadIfServerActionStale } from "@/lib/server-action-error";
import { cn } from "@/lib/utils";
import type {
  AppriseStatus,
  CodebergTokenCheckResult,
  NotificationConfig,
  RateLimitResult,
  UpdateNotificationState,
} from "@/types";

interface TestPageClientProps {
  rateLimitResult: RateLimitResult;
  isTokenSet: boolean;
  codebergTokenCheck: CodebergTokenCheckResult;
  notificationConfig: NotificationConfig;
  appriseStatus: AppriseStatus;
  updateNotice: UpdateNotificationState;
}

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

  const { toast } = useToast();
  const [resetTime, setResetTime] = React.useState(t("not_available"));
  const [isPasswordVisible, setIsPasswordVisible] = React.useState(false);
  const [customEmail, setCustomEmail] = React.useState("");
  const [isEmailInvalid, setIsEmailInvalid] = React.useState(false);
  const [appriseStatus, setAppriseStatus] =
    React.useState(initialAppriseStatus);
  const [updateNotice, setUpdateNotice] = React.useState(initialUpdateNotice);
  const emailInputId = React.useId();

  const rateLimitData = rateLimitResult.data;
  const rateLimitError = rateLimitResult.error;
  const rateLimit = rateLimitData?.rate;
  const { isOnline } = useNetworkStatus();

  const isRateLimitHigh = rateLimit ? rateLimit.limit > 1000 : false;
  const requiredMailVars = [
    "MAIL_HOST",
    "MAIL_PORT",
    "MAIL_FROM_ADDRESS",
    "MAIL_TO_ADDRESS",
  ];
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

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Github className="size-8 text-muted-foreground" />
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
            <CodebergIcon className="size-8 text-muted-foreground" />
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

          <p className="pl-7 break-all font-mono text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">APPRISE_URL=</span>
            {notificationConfig.variables.APPRISE_URL ? (
              <span>{notificationConfig.variables.APPRISE_URL}</span>
            ) : (
              <span className="italic">{t("email_not_set")}</span>
            )}
          </p>
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

            {notificationConfig.variables.MAIL_PASSWORD && (
              <div className="flex items-center gap-2 rounded-lg border border-yellow-500/50 bg-yellow-500/10 p-3 text-sm text-yellow-300">
                <AlertTriangle className="size-5 shrink-0" />
                <p>{t("email_password_warning")}</p>
              </div>
            )}
            <div className="text-sm text-muted-foreground font-mono space-y-2 break-all">
              {Object.entries(notificationConfig.variables).map(
                ([key, value]) => {
                  if (key === "APPRISE_URL") return null;
                  const isRequired = requiredMailVars.includes(key);
                  const isMissingAndRequired = isRequired && !value;

                  if (key === "MAIL_PASSWORD" && value) {
                    return (
                      <div key={key} className="flex items-center gap-2">
                        <p className="grow">
                          <span className="font-semibold text-foreground">
                            {key}=
                          </span>
                          <span>{isPasswordVisible ? value : "••••••••"}</span>
                        </p>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          onClick={() =>
                            setIsPasswordVisible(!isPasswordVisible)
                          }
                          aria-label={t(
                            isPasswordVisible
                              ? "hide_password"
                              : "show_password",
                          )}
                        >
                          {isPasswordVisible ? (
                            <EyeOff className="size-4" />
                          ) : (
                            <Eye className="size-4" />
                          )}
                        </Button>
                      </div>
                    );
                  }

                  return (
                    <p key={key}>
                      <span className="font-semibold text-foreground">
                        {key}=
                      </span>
                      {value ? (
                        <span>{value}</span>
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
                },
              )}
            </div>
          </div>

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
