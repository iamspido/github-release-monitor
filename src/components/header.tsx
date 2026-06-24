"use client";

import { Loader2, LogIn, LogOut } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";
import { logout } from "@/app/auth/actions";
import { GithubBrandIcon } from "@/components/icons/simple-brand-icon";
import { Logo } from "@/components/logo";
import {
  defaultAuthAccess,
  getNavLinks,
  isNavLinkActive,
} from "@/components/navigation-model";
import { OfflineBanner } from "@/components/offline-banner";
import { Button } from "@/components/ui/button";
import { UpdateNoticeBanner } from "@/components/update-notice-banner";
import { useNetworkStatus } from "@/hooks/use-network";
import { Link, usePathname } from "@/i18n/navigation";
import type { AuthAccess } from "@/lib/auth/mode";
import { reloadIfServerActionStale } from "@/lib/server-action-error";
import { cn } from "@/lib/utils";
import type { UpdateNotificationState } from "@/types";
import { MobileMenu } from "./mobile-menu";

type HeaderProps = {
  locale: string;
  updateNotice?: UpdateNotificationState;
  authAccess?: AuthAccess;
};

export function Header({
  locale,
  updateNotice,
  authAccess = defaultAuthAccess,
}: HeaderProps) {
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

  const navLinks = getNavLinks(authAccess, t);
  const isActive = (href: (typeof navLinks)[number]["href"]) =>
    isNavLinkActive({ href, locale, pathname });

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
          <MobileMenu
            onLogout={handleLogout}
            isLoggingOut={isLoggingOut}
            authAccess={authAccess}
          />

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
                <GithubBrandIcon className="size-5" />
              </Button>
            </a>
            {authAccess.showLogin && (
              <Link href="/login" passHref>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("login_aria")}
                >
                  <LogIn className="size-5" />
                </Button>
              </Link>
            )}
            {authAccess.showLogout && (
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
            )}
          </div>
        </div>
      </div>
      <OfflineBanner />
      <UpdateNoticeBanner
        notice={updateNotice}
        canDismiss={authAccess.canMutate}
      />
    </header>
  );
}
