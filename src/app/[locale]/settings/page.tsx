
import * as React from 'react';
import { getSettings } from '@/lib/settings-storage';
import { SettingsForm } from '@/components/settings-form';
import type { AppSettings } from '@/types';
import { getTranslations } from 'next-intl/server';
import { Header } from '@/components/header';

export default async function SettingsPage({params}: {params: Promise<{locale: string}>}) {
  const { locale } = await params;
  const t = await getTranslations({locale: locale, namespace: 'SettingsPage'});
  const currentSettings: AppSettings = await getSettings();
  const isAppriseConfigured = !!process.env.APPRISE_URL;

  return (
    <div className="min-h-screen w-full bg-background text-foreground">
      <Header locale={locale} />
      <main className="container mx-auto px-4 py-8 md:px-6">
        <div className="mx-auto max-w-2xl">
            <h2 className="mb-8 text-3xl font-bold tracking-tight break-words">{t('title')}</h2>
            <SettingsForm
              currentSettings={currentSettings}
              isAppriseConfigured={isAppriseConfigured}
            />
        </div>
      </main>
    </div>
  );
}
