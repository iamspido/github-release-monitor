import * as React from "react";
import {
  checkAppriseStatusAction,
  sendTestAppriseAction,
  sendTestEmailAction,
  setupTestRepositoryAction,
  triggerAppUpdateCheckAction,
  triggerReleaseCheckAction,
} from "@/app/actions";
import { useToast } from "@/hooks/use-toast";
import { reloadIfServerActionStale } from "@/lib/server-action-error";
import type { AppriseStatus, UpdateNotificationState } from "@/types";

type DiagnosticsTranslator = (
  key: string,
  values?: Record<string, string | number | Date>,
) => string;

export function useDiagnosticsActions(args: {
  initialAppriseStatus: AppriseStatus;
  initialUpdateNotice: UpdateNotificationState;
  t: DiagnosticsTranslator;
}) {
  const { t } = args;
  const { toast } = useToast();
  const [isSendingMail, startMailTransition] = React.useTransition();
  const [isSettingUpRepo, startSetupRepoTransition] = React.useTransition();
  const [isTriggeringCheck, startTriggerCheckTransition] =
    React.useTransition();
  const [isSendingApprise, startAppriseTransition] = React.useTransition();
  const [isCheckingApprise, startAppriseCheckTransition] =
    React.useTransition();
  const [isCheckingUpdate, startUpdateTransition] = React.useTransition();
  const [customEmail, setCustomEmail] = React.useState("");
  const [isEmailInvalid, setIsEmailInvalid] = React.useState(false);
  const [appriseStatus, setAppriseStatus] = React.useState(
    args.initialAppriseStatus,
  );
  const [updateNotice, setUpdateNotice] = React.useState(
    args.initialUpdateNotice,
  );

  const handleEmailChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const email = event.target.value;
    setCustomEmail(email);
    setIsEmailInvalid(
      email.trim().length > 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
    );
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
          return;
        }
        toast({
          title: t("toast_email_error_title"),
          description: result.error || t("toast_email_error_description"),
          variant: "destructive",
        });
      } catch (error: unknown) {
        if (reloadIfServerActionStale(error)) return;
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
          return;
        }
        toast({
          title: t("toast_apprise_error_title"),
          description: result.error,
          variant: "destructive",
        });
      } catch (error: unknown) {
        if (reloadIfServerActionStale(error)) return;
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

        toast({
          title: t("toast_success_title"),
          description: result.notice.shouldNotify
            ? t("toast_update_available_description", {
                version: result.notice.latestVersion ?? t("not_available"),
              })
            : t("toast_update_not_available_description"),
        });
      } catch (error: unknown) {
        if (reloadIfServerActionStale(error)) return;
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
          "data-result": result.success ? "success" : "error",
          "data-testid": "test-repository-result",
          title: result.success
            ? t("toast_success_title")
            : t("toast_error_title"),
          description: result.message,
          variant: result.success ? "default" : "destructive",
        });
      } catch (error: unknown) {
        if (reloadIfServerActionStale(error)) return;
        toast({
          "data-result": "error",
          "data-testid": "test-repository-result",
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
        if (reloadIfServerActionStale(error)) return;
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
        if (reloadIfServerActionStale(error)) return;
        toast({
          title: t("toast_error_title"),
          description: t("apprise_error"),
          variant: "destructive",
        });
      }
    });
  };

  return {
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
  };
}
