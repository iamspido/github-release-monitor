"use client";

import { Download, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { getRepositoriesForExport } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { useActionTransition } from "@/hooks/use-action-transition";
import { useNetworkStatus } from "@/hooks/use-network";
import { useToast } from "@/hooks/use-toast";

export function ExportButton() {
  const t = useTranslations("HomePage");
  const { toast } = useToast();
  const { isPending, runAction } = useActionTransition();
  const { isOnline } = useNetworkStatus();

  const handleExport = () => {
    runAction(
      async () => {
        const result = await getRepositoriesForExport();

        if (result.success && result.data) {
          let url: string | null = null;
          let anchor: HTMLAnchorElement | null = null;
          try {
            // Create a blob from the JSON data
            const blob = new Blob([JSON.stringify(result.data, null, 2)], {
              type: "application/json",
            });

            // Create a temporary URL for the blob
            url = window.URL.createObjectURL(blob);

            // Create a temporary anchor element and trigger the download
            anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = "repositories.json";
            document.body.appendChild(anchor);
            anchor.click();

            toast({
              title: t("toast_export_success_title"),
              description: t("toast_export_success_description"),
            });
          } catch (error: unknown) {
            console.error("Client-side export failed:", error);
            toast({
              title: t("toast_export_error_title"),
              description: t("toast_export_error_description"),
              variant: "destructive",
            });
          } finally {
            anchor?.remove();
            if (url) window.URL.revokeObjectURL(url);
          }
        } else {
          toast({
            title: t("toast_export_error_title"),
            description: result.error || t("toast_export_error_description"),
            variant: "destructive",
          });
        }
      },
      () => {
        toast({
          title: t("toast_export_error_title"),
          description: t("toast_export_error_description"),
          variant: "destructive",
        });
      },
    );
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
        <Loader2 className="me-2 size-4 animate-spin" />
      ) : (
        <Download className="me-2 size-4" />
      )}
      {t("export_button")}
    </Button>
  );
}
