"use client";

import { Loader2, LogIn, LogOut, Menu } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import * as React from "react";
import { GithubBrandIcon } from "@/components/icons/simple-brand-icon";
import {
  defaultAuthAccess,
  getNavLinks,
  isNavLinkActive,
} from "@/components/navigation-model";
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
import type { AuthAccess } from "@/lib/auth/mode";
import { cn } from "@/lib/utils";

interface MobileMenuProps {
  onLogout: () => void;
  isLoggingOut: boolean;
  authAccess?: AuthAccess;
}

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

  const navLinks = getNavLinks(authAccess, t);
  const isActive = (href: (typeof navLinks)[number]["href"]) =>
    isNavLinkActive({ href, locale, pathname });

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
                  <link.icon className="me-2 size-4" />
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
              <GithubBrandIcon className="me-2 size-4" />
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
                  <LogIn className="me-2 size-4 rtl:scale-x-[-1]" />
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
                    <Loader2 className="me-2 size-4 animate-spin" />
                  ) : (
                    <LogOut className="me-2 size-4 rtl:scale-x-[-1]" />
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
