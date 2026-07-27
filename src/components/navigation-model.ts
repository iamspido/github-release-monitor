import { FlaskConical, Home, Settings } from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { pathnames } from "@/i18n/routing";
import { getCanonicalRoutePath } from "@/i18n/routing";
import type { AuthAccess } from "@/lib/auth/mode";
import { stripLocalePrefix } from "@/lib/localized-path";

export type NavPage = "home" | "settings" | "test";

export type NavLink = {
  href: keyof typeof pathnames;
  label: string;
  icon: typeof Home;
  page: NavPage;
};

export const defaultAuthAccess: AuthAccess = {
  authenticationMethod: "Basic",
  isAuthenticated: true,
  canMutate: true,
  canAccessRestrictedPages: true,
  showLogin: false,
  showLogout: true,
  showSettings: true,
  showTest: true,
};

export function getNavLinks(
  authAccess: AuthAccess,
  t: (key: string) => string,
): NavLink[] {
  return [
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
}

export function normalizeLocalizedPath(
  path: string | null | undefined,
  locale: Locale,
): string {
  if (!path) {
    return "/";
  }

  let normalized = stripLocalePrefix(path, locale);

  if (!normalized.startsWith("/")) {
    normalized = `/${normalized}`;
  }

  if (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}

export function isNavLinkActive(args: {
  href: keyof typeof pathnames;
  locale: Locale;
  pathname: string | null | undefined;
}): boolean {
  const currentPath = normalizeLocalizedPath(args.pathname, args.locale);
  const candidates = new Set<string>();

  candidates.add(normalizeLocalizedPath(args.href, args.locale));

  const localizedPath = getCanonicalRoutePath(args.href, args.locale);
  candidates.add(normalizeLocalizedPath(localizedPath, args.locale));

  return candidates.has(currentPath);
}
