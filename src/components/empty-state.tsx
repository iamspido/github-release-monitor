import { Telescope } from "lucide-react";
import { useTranslations } from "next-intl";

export function EmptyState() {
  const t = useTranslations('EmptyState');
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed bg-card p-12 text-center shadow-sm">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 mb-4">
        <Telescope className="h-8 w-8 text-primary" />
      </div>
      <h3 className="text-2xl font-semibold tracking-tight">
        {t('title')}
      </h3>
      <div className="mt-2 text-muted-foreground">
        <p>{t('description_line1')}</p>
        <p>{t('description_line2')}</p>
      </div>
    </div>
  );
}
