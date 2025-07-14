
'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { RefreshCw, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { refreshAndCheckAction } from '@/app/actions';
import { useRouter } from '@/navigation';

export function RefreshButton() {
  const t = useTranslations('HomePage');
  const { toast } = useToast();
  const [isPending, startTransition] = React.useTransition();
  const router = useRouter();

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    startTransition(async () => {
      try {
        const result = await refreshAndCheckAction();
        // After invalidating the cache on the server, refresh the page's data
        router.refresh(); 
        toast({
          title: t('toast_refresh_success_title'),
          description: t(result.messageKey),
        });
      } catch (error) {
        console.error("Manual refresh failed:", error);
        toast({
          title: t('toast_refresh_error_title'),
          description: t('toast_refresh_error_description'),
          variant: 'destructive',
        });
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="w-full sm:w-auto">
      <Button type="submit" variant="outline" size="sm" className="w-full" disabled={isPending}>
        {isPending ? (
          <Loader2 className="mr-2 size-4 animate-spin" />
        ) : (
          <RefreshCw className="mr-2 size-4" />
        )}
        {t('refresh')}
      </Button>
    </form>
  );
}

    
