"use client";

import {
  FlaskConical,
  Github,
  Home,
  Loader2,
  LogOut,
  Settings,
} from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";
import { logout } from "@/app/auth/actions";
import { Logo } from "@/components/logo";
import { OfflineBanner } from "@/components/offline-banner";
import { Button } from "@/components/ui/button";
import { UpdateNoticeBanner } from "@/components/update-notice-banner";
import { useNetworkStatus } from "@/hooks/use-network";
import { Link, usePathname } from "@/i18n/navigation";
import { pathnames } from "@/i18n/routing";
import { reloadIfServerActionStale } from "@/lib/server-action-error";
import { cn } from "@/lib/utils";
import type { UpdateNotificationState } from "@/types";
import { MobileMenu } from "./mobile-menu";

type HeaderProps = {
  locale: string;
  updateNotice?: UpdateNotificationState;
};

type NavLink = {
  href: keyof typeof pathnames;
  label: string;
  icon: typeof Home;
  page: "home" | "settings" | "test";
};

export function Header({ locale, updateNotice }: HeaderProps) {
  const t = useTranslations("HomePage");
  const pathname = usePathname();
  const [isLoggingOut, startLogoutTransition] = React.useTransition();
  const { isOnline } = useNetworkStatus();
  const isNextRedirectError = (error: unknown) => {
    if (!(error instanceof Error)) {
      return false;
    }
    const digest =
      typeof (error as { digest?: unknown }).digest === "string"
        ? (error as { digest?: unknown }).digest
        : undefined;
    return (
      error.message === "NEXT_REDIRECT" ||
      (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT"))
    );
  };

  const handleLogout = () => {
    startLogoutTransition(async () => {
      try {
        await logout();
      } catch (error: unknown) {
        if (isNextRedirectError(error)) {
          return;
        }
        if (reloadIfServerActionStale(error)) {
          return;
        }
        console.error("Logout failed:", error);
      }
    });
  };

  const navLinks: NavLink[] = [
    { href: "/", label: t("home_aria"), icon: Home, page: "home" },
    {
      href: "/settings",
      label: t("settings_aria"),
      icon: Settings,
      page: "settings",
    },
    { href: "/test", label: t("test_aria"), icon: FlaskConical, page: "test" },
  ];

  const normalizePath = (path: string | null | undefined) => {
    if (!path) {
      return "/";
    }

    const localePrefix = `/${locale}`;
    let normalized = path;

    if (normalized === localePrefix) {
      return "/";
    }

    if (normalized.startsWith(`${localePrefix}/`)) {
      normalized = normalized.slice(localePrefix.length);
    }

    if (!normalized.startsWith("/")) {
      normalized = `/${normalized}`;
    }

    if (normalized.length > 1 && normalized.endsWith("/")) {
      normalized = normalized.slice(0, -1);
    }

    return normalized;
  };

  const isActive = (href: keyof typeof pathnames) => {
    const currentPath = normalizePath(pathname);
    const candidates = new Set<string>();

    candidates.add(normalizePath(href));

    const routeConfig = pathnames[href];
    const localizedPath = routeConfig?.[locale as "en" | "de"];
    if (localizedPath) {
      candidates.add(normalizePath(localizedPath));
    }

    return candidates.has(currentPath);
  };

  return (
    <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur-xs">
      <div className="container mx-auto flex h-16 items-center justify-between gap-4 px-4 md:px-6">
        <Link href="/" className="flex items-center gap-3 hover:no-underline">
          <Logo />
          <h1 className="text-xl font-bold tracking-tight text-foreground">
            {t("title")}
          </h1>
        </Link>
        <div className="flex items-center gap-2">
          <MobileMenu onLogout={handleLogout} isLoggingOut={isLoggingOut} />

          <div className="hidden items-center gap-2 md:flex">
            {navLinks.map((link) => (
              <Link key={link.href} href={link.href} passHref>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={link.label}
                  className={cn(isActive(link.href) && "bg-secondary")}
                >
                  <link.icon className="size-5" />
                </Button>
              </Link>
            ))}
            <a
              href="https://github.com/iamspido/github-release-monitor"
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t("github_aria")}
            >
              <Button variant="ghost" size="icon">
                <Github className="size-5" />
              </Button>
            </a>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleLogout}
              disabled={isLoggingOut || !isOnline}
              aria-label={t("logout_aria")}
            >
              {isLoggingOut ? (
                <Loader2 className="size-5 animate-spin" />
              ) : (
                <LogOut className="size-5" />
              )}
            </Button>
          </div>
        </div>
      </div>
      <OfflineBanner />
      <UpdateNoticeBanner notice={updateNotice} />
    </header>
  );
}
