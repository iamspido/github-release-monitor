'use client';

import * as React from 'react';
import { WifiOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useNetworkStatus } from '@/hooks/use-network';

export function OfflineBanner() {
  const { isOnline } = useNetworkStatus();
  const t = useTranslations('HomePage');

  // Debounce visibility to avoid flicker on quick reconnects
  const [show, setShow] = React.useState(false);
  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (!isOnline) {
      timer = setTimeout(() => setShow(true), 350);
    } else {
      timer = setTimeout(() => setShow(false), 350);
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [isOnline]);

  return (
    <div
      aria-live="polite"
      className={[
        'w-full border-b transition-all duration-300 ease-out overflow-hidden',
        show ? 'border-yellow-500/40 bg-yellow-500/10 max-h-14 opacity-100' : 'border-transparent max-h-0 opacity-0'
      ].join(' ')}
    >
      <div className="container mx-auto px-4 md:px-6 py-2">
        <div className="flex items-center gap-2 text-sm text-yellow-300">
          <WifiOff className="size-4" />
          <span className="font-medium">{t('offline_banner_title')}</span>
          <span className="opacity-80">{t('offline_banner_description')}</span>
        </div>
      </div>
    </div>
  );
}
