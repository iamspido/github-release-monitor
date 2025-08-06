'use client';

import * as React from 'react';
import { Github, FlaskConical, Settings, LogOut, Home, Menu, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link, usePathname, useRouter } from '@/navigation';
import { cn } from '@/lib/utils';
import { pathnames } from '@/i18n';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { useLocale } from 'next-intl';

interface MobileMenuProps {
  onLogout: () => void;
  isLoggingOut: boolean;
}

export function MobileMenu({ onLogout, isLoggingOut }: MobileMenuProps) {
  const t = useTranslations('HomePage');
  const pathname = usePathname();
  const router = useRouter();
  const locale = useLocale();

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
          <DropdownMenuItem asChild onSelect={onLogout} disabled={isLoggingOut}>
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
