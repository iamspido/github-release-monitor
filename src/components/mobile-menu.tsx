'use client';

import * as React from 'react';
import { Github, FlaskConical, Settings, LogOut, Home, Menu, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { pathnames } from '@/i18n/routing';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { useLocale } from 'next-intl';
import { useNetworkStatus } from '@/hooks/use-network';

interface MobileMenuProps {
  onLogout: () => void;
  isLoggingOut: boolean;
}

export function MobileMenu({ onLogout, isLoggingOut }: MobileMenuProps) {
  const t = useTranslations('HomePage');
  const pathname = usePathname();
  const router = useRouter();
  const locale = useLocale();
  const { isOnline } = useNetworkStatus();

  const navLinks = [
    { href: '/', label: t('home_aria'), icon: Home, page: 'home' },
    { href: '/settings', label: t('settings_aria'), icon: Settings, page: 'settings' },
    { href: '/test', label: t('test_aria'), icon: FlaskConical, page: 'test' },
  ];

  const normalizePath = (path: string | null | undefined) => {
    if (!path) {
      return '/';
    }

    const localePrefix = `/${locale}`;
    let normalized = path;

    if (normalized === localePrefix) {
      return '/';
    }

    if (normalized.startsWith(`${localePrefix}/`)) {
      normalized = normalized.slice(localePrefix.length);
    }

    if (!normalized.startsWith('/')) {
      normalized = `/${normalized}`;
    }

    if (normalized.length > 1 && normalized.endsWith('/')) {
      normalized = normalized.slice(0, -1);
    }

    return normalized;
  };

  const isActive = (href: keyof typeof pathnames | '/') => {
    const currentPath = normalizePath(pathname);
    const candidates = new Set<string>();

    candidates.add(normalizePath(href));

    const routeConfig = pathnames[href as keyof typeof pathnames];
    const localizedPath = routeConfig?.[locale as 'en' | 'de'];
    if (localizedPath) {
      candidates.add(normalizePath(localizedPath));
    }

    return candidates.has(currentPath);
  };

  return (
    <div className="md:hidden">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon">
            <Menu className="size-5" />
            <span className="sr-only">{t('menu_open')}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {navLinks.map((link) => (
            <React.Fragment key={link.href}>
              <DropdownMenuItem
                asChild
                onSelect={() => router.push(link.href as any)}
                className={cn("flex w-full cursor-pointer items-center", isActive(link.href as any) && 'bg-secondary')}
              >
                <button>
                  <link.icon className="mr-2 size-4" />
                  <span>{t(`menu_${link.page}` as any)}</span>
                </button>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </React.Fragment>
          ))}
          <DropdownMenuItem asChild>
            <a href="https://github.com/iamspido/github-release-monitor" target="_blank" rel="noopener noreferrer" className="flex w-full cursor-pointer items-center">
              <Github className="mr-2 size-4" />
              <span>{t('menu_github')}</span>
            </a>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild onSelect={onLogout} disabled={isLoggingOut || !isOnline}>
            <button type="button" className="flex w-full cursor-pointer items-center">
              {isLoggingOut ? <Loader2 className="mr-2 size-4 animate-spin" /> : <LogOut className="mr-2 size-4" />}
              <span>{t('menu_logout')}</span>
            </button>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
