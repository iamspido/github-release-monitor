import { LoginForm } from '@/components/auth/login-form';
import { Logo } from '@/components/logo';
import { getTranslations } from 'next-intl/server';

export default async function LoginPage({params}: {params: Promise<{locale: string}>}) {
  const { locale } = await params;
  const t = await getTranslations({locale, namespace: 'LoginPage'});

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-4">
            <Logo />
            <h1 className="text-2xl font-bold tracking-tight text-center">{t('title')}</h1>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
