
import * as React from 'react';
import { getGitHubRateLimit } from '@/app/actions';
import { TestPageClient } from '@/components/test-page-client';
import type { RateLimitResult, MailConfig } from '@/types';
import { getTranslations } from 'next-intl/server';
import { Header } from '@/components/header';

function getMailConfigDetails(): MailConfig {
  const {
    MAIL_HOST,
    MAIL_PORT,
    MAIL_USERNAME,
    MAIL_PASSWORD,
    MAIL_FROM_ADDRESS,
    MAIL_FROM_NAME,
    MAIL_TO_ADDRESS,
  } = process.env;

  const isConfigured = !!(MAIL_HOST && MAIL_PORT && MAIL_FROM_ADDRESS && MAIL_TO_ADDRESS);

  return {
    isConfigured,
    variables: {
      MAIL_HOST: MAIL_HOST || null,
      MAIL_PORT: MAIL_PORT || null,
      MAIL_USERNAME: MAIL_USERNAME || null,
      MAIL_PASSWORD: MAIL_PASSWORD || null,
      MAIL_FROM_ADDRESS: MAIL_FROM_ADDRESS || null,
      MAIL_FROM_NAME: MAIL_FROM_NAME || null,
      MAIL_TO_ADDRESS: MAIL_TO_ADDRESS || null,
    }
  };
}

export default async function TestPage({params}: {params: Promise<{locale: string}>}) {
  const { locale } = await params;
  const t = await getTranslations({locale: locale, namespace: 'TestPage'});
  const rateLimitResult: RateLimitResult = await getGitHubRateLimit();
  const githubTokenSet = !!process.env.GITHUB_ACCESS_TOKEN;
  const mailConfig = getMailConfigDetails();
  
  return (
    <div className="min-h-screen w-full bg-background text-foreground">
      <Header locale={locale} />
      <main className="container mx-auto px-4 py-8 md:px-6">
        <h2 className="mb-8 text-3xl font-bold tracking-tight break-words">{t('title')}</h2>
        <TestPageClient
            rateLimitResult={rateLimitResult}
            isTokenSet={githubTokenSet}
            mailConfig={mailConfig}
        />
      </main>
    </div>
  );
}
