"use client";

import { Download, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";

import { getRepositoriesForExport } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { useNetworkStatus } from "@/hooks/use-network";
import { useToast } from "@/hooks/use-toast";
import { reloadIfServerActionStale } from "@/lib/server-action-error";

export function ExportButton() {
  const t = useTranslations("HomePage");
  const { toast } = useToast();
  const [isPending, startTransition] = React.useTransition();
  const { isOnline } = useNetworkStatus();

  const handleExport = () => {
    startTransition(async () => {
      try {
        const result = await getRepositoriesForExport();

        if (result.success && result.data) {
          try {
            // Create a blob from the JSON data
            const blob = new Blob([JSON.stringify(result.data, null, 2)], {
              type: "application/json",
            });

            // Create a temporary URL for the blob
            const url = window.URL.createObjectURL(blob);

            // Create a temporary anchor element and trigger the download
            const a = document.createElement("a");
            a.href = url;
            a.download = "repositories.json";
            document.body.appendChild(a);
            a.click();

            // Clean up the temporary elements
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);

            toast({
              title: t("toast_export_success_title"),
              description: t("toast_export_success_description"),
            });
          } catch (error: unknown) {
            console.error("Client-side export failed:", error);
            toast({
              title: t("toast_export_error_title"),
              description: String(error) || t("toast_export_error_description"),
              variant: "destructive",
            });
          }
        } else {
          toast({
            title: t("toast_export_error_title"),
            description: result.error || t("toast_export_error_description"),
            variant: "destructive",
          });
        }
      } catch (error: unknown) {
        if (reloadIfServerActionStale(error)) {
          return;
        }
        toast({
          title: t("toast_export_error_title"),
          description: t("toast_export_error_description"),
          variant: "destructive",
        });
      }
    });
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="w-full sm:w-auto"
      disabled={isPending || !isOnline}
      onClick={handleExport}
    >
      {isPending ? (
        <Loader2 className="mr-2 size-4 animate-spin" />
      ) : (
        <Download className="mr-2 size-4" />
      )}
      {t("export_button")}
    </Button>
  );
}
