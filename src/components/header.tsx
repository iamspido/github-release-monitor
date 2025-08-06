'use client';

import * as React from 'react';
import { Github, FlaskConical, Settings, LogOut, Home, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/navigation';
import { cn } from '@/lib/utils';
import { pathnames } from '@/i18n';
import { logout } from '@/app/auth/actions';

import { Button } from '@/components/ui/button';
import { Logo } from '@/components/logo';
import { MobileMenu } from './mobile-menu';

export function Header({ locale }: { locale: string }) {
  const t = useTranslations('HomePage');
  const pathname = usePathname();
  const [isLoggingOut, startLogoutTransition] = React.useTransition();

  const handleLogout = () => {
    startLogoutTransition(async () => {
      await logout();
    });
  };

  const navLinks = [
    { href: '/', label: t('home_aria'), icon: Home, page: 'home' },
    { href: '/settings', label: t('settings_aria'), icon: Settings, page: 'settings' },
    { href: '/test', label: t('test_aria'), icon: FlaskConical, page: 'test' },
  ];

  const isActive = (href: keyof typeof pathnames | '/') => {
    if (href === '/') {
      return pathname === '/';
    }
    const translatedPath = pathnames[href]?.[locale as 'en' | 'de'] || href;
    return pathname === translatedPath;
  };

  return (
    <>
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur-sm">
        <div className="container mx-auto flex h-16 items-center justify-between gap-4 px-4 md:px-6">
          <Link href="/" className="flex items-center gap-3 hover:no-underline">
            <Logo />
            <h1 className="text-xl font-bold tracking-tight text-foreground">
              {t('title')}
            </h1>
          </Link>
          <div className="flex items-center gap-2">
            <MobileMenu onLogout={handleLogout} isLoggingOut={isLoggingOut} />

            <div className="hidden items-center gap-2 md:flex">
              {navLinks.map(link => (
                <Link key={link.href} href={link.href as any} passHref>
                  <Button variant="ghost" size="icon" aria-label={link.label} className={cn(isActive(link.href as any) && 'bg-secondary')}>
                    <link.icon className="size-5" />
                  </Button>
                </Link>
              ))}
              <a
                href="https://github.com/iamspido/github-release-monitor"
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t('github_aria')}
              >
                <Button variant="ghost" size="icon">
                  <Github className="size-5" />
                </Button>
              </a>
              <Button variant="ghost" size="icon" onClick={handleLogout} disabled={isLoggingOut} aria-label={t('logout_aria')}>
                {isLoggingOut ? <Loader2 className="size-5 animate-spin" /> : <LogOut className="size-5" />}
              </Button>
            </div>
          </div>
        </div>
      </header>
    </>
  );
}
