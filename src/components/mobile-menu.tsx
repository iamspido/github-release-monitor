"use client";

import {
  FlaskConical,
  Home,
  Loader2,
  LogIn,
  LogOut,
  Menu,
  Settings,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import * as React from "react";
import { GithubBrandIcon } from "@/components/icons/simple-brand-icon";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useNetworkStatus } from "@/hooks/use-network";
import { usePathname, useRouter } from "@/i18n/navigation";
import { pathnames } from "@/i18n/routing";
import type { AuthAccess } from "@/lib/auth/mode";
import { cn } from "@/lib/utils";

interface MobileMenuProps {
  onLogout: () => void;
  isLoggingOut: boolean;
  authAccess?: AuthAccess;
}

type NavPage = "home" | "settings" | "test";

type NavLink = {
  href: keyof typeof pathnames;
  label: string;
  icon: typeof Home;
  page: NavPage;
};

const defaultAuthAccess: AuthAccess = {
  authenticationMethod: "Basic",
  isAuthenticated: true,
  canMutate: true,
  canAccessRestrictedPages: true,
  showLogin: false,
  showLogout: true,
  showSettings: true,
  showTest: true,
};

export function MobileMenu({
  onLogout,
  isLoggingOut,
  authAccess = defaultAuthAccess,
}: MobileMenuProps) {
  const t = useTranslations("HomePage");
  const pathname = usePathname();
  const router = useRouter();
  const locale = useLocale();
  const { isOnline } = useNetworkStatus();

  const navLinks: NavLink[] = [
    { href: "/", label: t("home_aria"), icon: Home, page: "home" },
    ...(authAccess.showSettings
      ? [
          {
            href: "/settings" as const,
            label: t("settings_aria"),
            icon: Settings,
            page: "settings" as const,
          },
        ]
      : []),
    ...(authAccess.showTest
      ? [
          {
            href: "/test" as const,
            label: t("test_aria"),
            icon: FlaskConical,
            page: "test" as const,
          },
        ]
      : []),
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
    <div className="md:hidden">
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon">
            <Menu className="size-5" />
            <span className="sr-only">{t("menu_open")}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {navLinks.map((link) => (
            <React.Fragment key={link.href}>
              <DropdownMenuItem
                asChild
                onSelect={() => router.push(link.href)}
                className={cn(
                  "flex w-full cursor-pointer items-center",
                  isActive(link.href) && "bg-secondary",
                )}
              >
                <button type="button">
                  <link.icon className="mr-2 size-4" />
                  <span>{t(`menu_${link.page}`)}</span>
                </button>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </React.Fragment>
          ))}
          <DropdownMenuItem asChild>
            <a
              href="https://github.com/iamspido/github-release-monitor"
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full cursor-pointer items-center"
            >
              <GithubBrandIcon className="mr-2 size-4" />
              <span>{t("menu_github")}</span>
            </a>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {authAccess.showLogin && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                asChild
                onSelect={() => router.push("/login")}
                className="flex w-full cursor-pointer items-center"
              >
                <button type="button">
                  <LogIn className="mr-2 size-4" />
                  <span>{t("menu_login")}</span>
                </button>
              </DropdownMenuItem>
            </>
          )}
          {authAccess.showLogout && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                asChild
                onSelect={onLogout}
                disabled={isLoggingOut || !isOnline}
              >
                <button
                  type="button"
                  className="flex w-full cursor-pointer items-center"
                >
                  {isLoggingOut ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : (
                    <LogOut className="mr-2 size-4" />
                  )}
                  <span>{t("menu_logout")}</span>
                </button>
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
