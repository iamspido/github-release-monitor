'use client';

import * as React from 'react';
import { useNetworkStatus } from '@/hooks/use-network';
import { useTranslations } from 'next-intl';

export function OfflineInlineNotice() {
  const { isOnline } = useNetworkStatus();
  const t = useTranslations('SettingsForm');
  if (isOnline) return null;
  return (
    <div className="mb-6 rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm text-yellow-300">
      {t('offline_notice')}
    </div>
  );
}

