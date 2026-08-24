"use client";

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
import { SecretRevealDialog } from "@/components/diagnostics/secret-reveal-dialog";
import { StatusIndicator } from "@/components/diagnostics/status-indicator";
import {
  CodebergBrandIcon,
  ForgejoBrandIcon,
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
import {
  type TestPageClientProps,
  useTestPageController,
} from "@/components/use-test-page-controller";
import { isolateLtrText } from "@/lib/bidi";
import { cn } from "@/lib/utils";

export function TestPageClient({
  rateLimitResult,
  isTokenSet,
  gitlabTokenCheck,
  codebergTokenCheck,
  forgejoTokenChecks,
  notificationConfig,
  appriseStatus: initialAppriseStatus,
  updateNotice: initialUpdateNotice,
  timeFormat,
}: TestPageClientProps) {
  const t = useTranslations("TestPage");
  const controller = useTestPageController({
    rateLimitResult,
    isTokenSet,
    gitlabTokenCheck,
    codebergTokenCheck,
    forgejoTokenChecks,
    notificationConfig,
    appriseStatus: initialAppriseStatus,
    updateNotice: initialUpdateNotice,
    timeFormat,
  });
  const {
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
  } = controller;
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
            <p className="ps-7 text-sm text-muted-foreground">
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
              <div className="mt-2 ps-7 text-sm text-muted-foreground space-y-1">
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
            <p className="ps-7 text-sm text-muted-foreground">
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
            <p className="ps-7 text-sm text-muted-foreground">
              {t("gitlab_token_advice")}
            </p>
          )}
          <div>
            <StatusIndicator
              status={gitlabAuthStatus.status}
              text={gitlabAuthStatus.text}
            />
            <div className="mt-2 ps-7 text-sm text-muted-foreground space-y-1">
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
            <p className="ps-7 text-sm text-muted-foreground">
              {t("codeberg_token_advice")}
            </p>
          )}
          <div>
            <StatusIndicator
              status={codebergAuthStatus.status}
              text={codebergAuthStatus.text}
            />
            <div className="mt-2 ps-7 text-sm text-muted-foreground space-y-1">
              {codebergDetails}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <ForgejoBrandIcon className="size-8 text-muted-foreground" />
            <div>
              <CardTitle>{t("forgejo_card_title")}</CardTitle>
              <CardDescription>{t("forgejo_card_description")}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {forgejoTokenChecks.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("forgejo_no_instances")}
            </p>
          ) : (
            forgejoTokenChecks.map((check) => {
              const authStatus = (() => {
                switch (check.status) {
                  case "not_set":
                    return check.connectivityError
                      ? {
                          status: "error" as const,
                          text: t("forgejo_token_check_error"),
                        }
                      : {
                          status: "success" as const,
                          text: t("forgejo_connectivity_confirmed"),
                        };
                  case "valid":
                    return check.diagnosticsLimited
                      ? {
                          status: "warning" as const,
                          text: t("auth_access_confirmed"),
                        }
                      : {
                          status: "success" as const,
                          text: t("auth_access_confirmed"),
                        };
                  case "invalid_token":
                    return {
                      status: "error" as const,
                      text: t("codeberg_token_invalid"),
                    };
                  case "api_error":
                    return {
                      status: "error" as const,
                      text: t("forgejo_token_check_error"),
                    };
                }
              })();

              return (
                <div
                  key={check.baseUrl}
                  className="space-y-3 border-t pt-4 first:border-t-0 first:pt-0"
                >
                  <p className="font-medium break-all">
                    <bdi dir="ltr">{check.baseUrl}</bdi>
                  </p>
                  <StatusIndicator
                    status={check.status === "not_set" ? "warning" : "success"}
                    text={t(
                      check.status === "not_set"
                        ? "forgejo_token_not_set"
                        : "forgejo_token_set",
                    )}
                  />
                  {check.status === "not_set" && (
                    <p className="ps-7 text-sm text-muted-foreground">
                      {t("forgejo_token_advice")}
                    </p>
                  )}
                  <StatusIndicator
                    status={authStatus.status}
                    text={authStatus.text}
                  />
                  <div className="ps-7 text-sm text-muted-foreground space-y-1">
                    {check.status === "valid" && check.login ? (
                      <p>
                        {t("forgejo_authenticated_as", {
                          login: check.login,
                        })}
                      </p>
                    ) : null}
                    {check.status === "valid" && check.fullName ? (
                      <p>{check.fullName}</p>
                    ) : null}
                    {check.status === "valid" && check.diagnosticsLimited ? (
                      <p>{t("forgejo_token_valid_limited_advice")}</p>
                    ) : null}
                    {check.status === "invalid_token" ? (
                      <p>{t("forgejo_invalid_token_advice")}</p>
                    ) : null}
                    {check.status === "api_error" ? (
                      <p>{t("forgejo_token_check_error_advice")}</p>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
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
          <div className="ps-7 text-sm text-muted-foreground space-y-1">
            <p>
              {t("update_current_version", {
                version: isolateLtrText(updateNotice.currentVersion),
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
              <p className="ps-7 text-sm text-muted-foreground">
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
          <div className="ps-7 flex items-center gap-2">
            <p
              dir="ltr"
              className="grow break-all font-mono text-sm text-muted-foreground"
            >
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

          <div className="ps-7 pt-4 border-t space-y-3">
            <h4 className="font-semibold text-sm">
              {t("email_all_variables_title")}
            </h4>

            {revealedMailPassword !== null && (
              <div className="flex items-center gap-2 rounded-lg border border-yellow-500/50 bg-yellow-500/10 p-3 text-sm text-yellow-300">
                <AlertTriangle className="size-5 shrink-0" />
                <p>{t("email_password_warning")}</p>
              </div>
            )}
            <div
              dir="ltr"
              className="text-sm text-muted-foreground font-mono space-y-2 break-all"
            >
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
                  <Loader2 className="me-2 animate-spin" />
                ) : (
                  <Mail className="me-2" />
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
              data-testid="setup-test-repository"
              onClick={handleSetupTestRepo}
              disabled={isSettingUpRepo || !isOnline}
            >
              {isSettingUpRepo ? (
                <Loader2 className="me-2 animate-spin" />
              ) : (
                <PackagePlus className="me-2" />
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
                  <Loader2 className="me-2 animate-spin" />
                ) : (
                  <RefreshCw className="me-2" />
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
