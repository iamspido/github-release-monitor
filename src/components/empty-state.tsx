import { Telescope } from "lucide-react";
import { useTranslations } from "next-intl";

type EmptyStateProps = {
  canMutate?: boolean;
};

export function EmptyState({ canMutate = true }: EmptyStateProps) {
  const t = useTranslations("EmptyState");
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed bg-card p-12 text-center shadow-xs">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
        <Telescope className="h-8 w-8 text-primary" />
      </div>
      <h3 className="text-2xl font-semibold tracking-tight">
        {canMutate ? t("title") : t("readonly_title")}
      </h3>
      <div className="mt-2 text-muted-foreground">
        <p>{canMutate ? t("description_line1") : t("readonly_line1")}</p>
        <p>{canMutate ? t("description_line2") : t("readonly_line2")}</p>
      </div>
    </div>
  );
}
