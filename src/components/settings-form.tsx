"use client";

import {
  AlertCircle,
  CheckCircle,
  Loader2,
  Save,
  Trash2,
  WifiOff,
} from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";
import { deleteAllRepositoriesAction } from "@/app/settings/actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { AutosaveStatus } from "@/hooks/use-autosave-controller";
import { useNetworkStatus } from "@/hooks/use-network";
import { useToast } from "@/hooks/use-toast";
import { useRouter } from "@/i18n/navigation";
import { reloadIfServerActionStale } from "@/lib/server-action-error";
import { cn } from "@/lib/utils";
import type { AppSettings, TimeFormat } from "@/types";
import { GeneralSecuritySettingsSections } from "./settings-general-security-sections";
import { NotificationSettingsSections } from "./settings-notification-sections";
import { ReleaseAutomationSettingsSections } from "./settings-release-automation-sections";
import { useSettingsFormController } from "./use-settings-form-controller";

function FloatingSaveIndicator({ status }: { status: AutosaveStatus }) {
  const t = useTranslations("SettingsForm");

  if (status === "idle") {
    return null;
  }

  const messages: Record<
    AutosaveStatus,
    { text: React.ReactNode; icon: React.ReactNode; className: string }
  > = {
    idle: { text: "", icon: null, className: "" },
    waiting: {
      text: t("autosave_waiting"),
      icon: <Save className="size-4" />,
      className: "text-muted-foreground",
    },
    saving: {
      text: t("autosave_saving"),
      icon: <Loader2 className="size-4 animate-spin" />,
      className: "text-muted-foreground",
    },
    success: {
      text: t("autosave_success"),
      icon: <CheckCircle className="size-4" />,
      className: "text-green-500",
    },
    error: {
      text: t("autosave_error"),
      icon: <AlertCircle className="size-4" />,
      className: "text-destructive",
    },
    paused: {
      text: t("autosave_paused_offline"),
      icon: <WifiOff className="size-4" />,
      className: "text-yellow-500",
    },
  };

  const current = messages[status];

  return (
    <div
      data-status={status}
      data-testid="autosave-status"
      className={cn(
        "fixed bottom-6 end-6 z-50 flex items-center gap-2 px-4 py-2.5 rounded-lg border bg-background shadow-lg transition-all duration-300 ease-in-out",
        current.className,
      )}
    >
      {current.icon}
      <span className="text-sm font-medium">{current.text}</span>
    </div>
  );
}

interface SettingsFormProps {
  currentSettings: AppSettings;
  isAppriseConfigured: boolean;
  isGithubTokenSet: boolean;
  onTimeFormatChange?: (timeFormat: TimeFormat) => void;
}

export function SettingsForm({
  currentSettings,
  isAppriseConfigured,
  isGithubTokenSet,
  onTimeFormatChange,
}: SettingsFormProps) {
  const controller = useSettingsFormController({
    currentSettings,
    isGithubTokenSet,
  });
  const { handleAutosaveBlur, handleAutosaveKeyDown, saveStatus } = controller;
  return (
    <>
      <FloatingSaveIndicator status={saveStatus} />

      {/* Delegated handlers give every text-like field consistent blur/Enter saving. */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: child form controls remain the interactive targets */}
      <div
        className="mx-auto max-w-2xl space-y-8"
        onBlur={handleAutosaveBlur}
        onKeyDown={handleAutosaveKeyDown}
      >
        <GeneralSecuritySettingsSections
          controller={controller}
          onTimeFormatChange={onTimeFormatChange}
        />

        <ReleaseAutomationSettingsSections controller={controller} />

        <NotificationSettingsSections
          controller={controller}
          isAppriseConfigured={isAppriseConfigured}
        />
      </div>
    </>
  );
}

export function SettingsDangerZoneCard() {
  const t = useTranslations("SettingsForm");
  const { toast } = useToast();
  const router = useRouter();
  const { isOnline } = useNetworkStatus();
  const [isDeleting, startDeleteTransition] = React.useTransition();

  const handleDeleteAll = () => {
    startDeleteTransition(async () => {
      try {
        const result = await deleteAllRepositoriesAction();
        toast({
          title: result.message.title,
          description: result.message.description,
          variant: result.success ? "default" : "destructive",
        });
        if (result.success) {
          router.push("/");
        }
      } catch (error: unknown) {
        if (reloadIfServerActionStale(error)) {
          return;
        }
        toast({
          title: t("toast_error_title"),
          description: t("toast_delete_all_error_description"),
          variant: "destructive",
        });
      }
    });
  };

  return (
    <Card className="mt-6 border-destructive/50">
      <CardHeader>
        <CardTitle className="text-destructive">
          {t("danger_zone_title")}
        </CardTitle>
        <CardDescription className="text-destructive/80">
          {t("danger_zone_description")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" disabled={isDeleting || !isOnline}>
              {isDeleting ? <Loader2 className="animate-spin" /> : <Trash2 />}
              {t("delete_all_button_text")}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("delete_all_dialog_title")}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t("delete_all_dialog_description")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isDeleting || !isOnline}>
                {t("cancel_button")}
              </AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={handleDeleteAll}
                disabled={isDeleting || !isOnline}
              >
                {isDeleting && <Loader2 className="animate-spin" />}
                {t("confirm_delete_button")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
