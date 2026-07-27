"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import type * as React from "react";

import { refreshAndCheckAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { useActionTransition } from "@/hooks/use-action-transition";
import { useNetworkStatus } from "@/hooks/use-network";
import { useToast } from "@/hooks/use-toast";
import { useRouter } from "@/i18n/navigation";

export function RefreshButton() {
  const t = useTranslations("HomePage");
  const { toast } = useToast();
  const { isPending, runAction } = useActionTransition();
  const router = useRouter();
  const { isOnline } = useNetworkStatus();

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    runAction(
      async () => {
        const result = await refreshAndCheckAction();
        // After invalidating the cache on the server, refresh the page's data
        router.refresh();
        toast({
          title: t("toast_refresh_success_title"),
          description: t(result.messageKey),
        });
      },
      (error) => {
        console.error("Manual refresh failed:", error);
        toast({
          title: t("toast_refresh_error_title"),
          description: t("toast_refresh_error_description"),
          variant: "destructive",
        });
      },
    );
  };

  return (
    <form onSubmit={handleSubmit} className="w-full sm:w-auto">
      <Button
        type="submit"
        variant="outline"
        size="sm"
        className="w-full"
        disabled={isPending || !isOnline}
      >
        {isPending ? (
          <Loader2 className="me-2 size-4 animate-spin" />
        ) : (
          <RefreshCw className="me-2 size-4" />
        )}
        {t("refresh")}
      </Button>
    </form>
  );
}
