import * as React from 'react';
import { getGitHubRateLimit, checkAppriseStatusAction } from '@/app/actions';
import { TestPageClient } from '@/components/test-page-client';
import type { RateLimitResult, NotificationConfig, AppriseStatus } from '@/types';
import { getTranslations } from 'next-intl/server';
import { Header } from '@/components/header';
import { logger } from '@/lib/logger';

function getNotificationConfig(): NotificationConfig {
  const {
    MAIL_HOST,
    MAIL_PORT,
    MAIL_USERNAME,
    MAIL_PASSWORD,
    MAIL_FROM_ADDRESS,
    MAIL_FROM_NAME,
    MAIL_TO_ADDRESS,
    APPRISE_URL,
  } = process.env;

  const isSmtpConfigured = !!(MAIL_HOST && MAIL_PORT && MAIL_FROM_ADDRESS && MAIL_TO_ADDRESS);
  const isAppriseConfigured = !!APPRISE_URL;

  return {
    isSmtpConfigured,
    isAppriseConfigured,
    variables: {
      MAIL_HOST: MAIL_HOST || null,
      MAIL_PORT: MAIL_PORT || null,
      MAIL_USERNAME: MAIL_USERNAME || null,
      MAIL_PASSWORD: MAIL_PASSWORD || null,
      MAIL_FROM_ADDRESS: MAIL_FROM_ADDRESS || null,
      MAIL_FROM_NAME: MAIL_FROM_NAME || null,
      MAIL_TO_ADDRESS: MAIL_TO_ADDRESS || null,
      APPRISE_URL: APPRISE_URL || null,
    }
  };
}

export default async function TestPage({params}: {params: Promise<{locale: string}>}) {
  const { locale } = await params;
  const t = await getTranslations({locale: locale, namespace: 'TestPage'});
  const rateLimitResult: RateLimitResult = await getGitHubRateLimit();
  const githubTokenSet = !!process.env.GITHUB_ACCESS_TOKEN;
  const notificationConfig = getNotificationConfig();

  let appriseStatus: AppriseStatus;
  try {
    // This action is now robust and will not throw on network errors.
    appriseStatus = await checkAppriseStatusAction();
  } catch (error) {
    // This is a fallback safety net. The action itself should handle errors.
    logger.withScope('WebServer').error("Critical error calling checkAppriseStatusAction:", error);
    appriseStatus = { status: 'error', error: t('apprise_connection_error_fetch') };
  }


  return (
    <div className="min-h-screen w-full bg-background text-foreground">
      <Header locale={locale} />
      <main className="container mx-auto px-4 py-8 md:px-6">
        <h2 className="mb-8 text-3xl font-bold tracking-tight break-words">{t('title')}</h2>
        <TestPageClient
            rateLimitResult={rateLimitResult}
            isTokenSet={githubTokenSet}
            notificationConfig={notificationConfig}
            appriseStatus={appriseStatus}
        />
      </main>
    </div>
  );
}
