// @vitest-environment jsdom
import type { ReactNode } from "react";
import { createElement } from "react";
import { flushSync } from "react-dom";
import ReactDOM from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

type LinkProps = {
  href: string;
  children?: ReactNode;
};

// We'll mock network status and import Header dynamically per test
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => {
    const map: Record<string, string> = {
      title: "GitHub Release Monitor",
      logout_aria: "Log out",
      home_aria: "Home",
      settings_aria: "Settings",
      test_aria: "Test Page",
      github_aria: "View source on GitHub",
    };
    return map[key] || key;
  },
  useLocale: () => "en",
}));

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children }: LinkProps) => <a href={href}>{children}</a>,
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/components/logo", () => ({
  Logo: () => createElement("div", { "data-testid": "logo" }),
}));

describe("Header logout disabled offline", () => {
  it("renders header in offline without errors", async () => {
    vi.resetModules();
    vi.doMock("@/hooks/use-network", () => ({
      useNetworkStatus: () => ({ isOnline: false }),
    }));
    vi.doMock("@/app/auth/actions", () => ({ logout: vi.fn() }));
    vi.doMock("next-intl", () => ({
      useTranslations: () => (key: string) =>
        (
          ({
            title: "GitHub Release Monitor",
            logout_aria: "Log out",
            home_aria: "Home",
            settings_aria: "Settings",
            test_aria: "Test Page",
            github_aria: "View source on GitHub",
          }) satisfies Record<string, string>
        )[key] || key,
      useLocale: () => "en",
    }));
    vi.doMock("@/i18n/navigation", () => ({
      Link: ({ href, children }: LinkProps) => <a href={href}>{children}</a>,
      usePathname: () => "/",
      useRouter: () => ({ push: vi.fn() }),
    }));
    vi.doMock("@/components/logo", () => ({
      Logo: () => createElement("div", { "data-testid": "logo" }),
    }));
    vi.doMock("@/components/offline-banner", () => ({
      OfflineBanner: () =>
        createElement("div", { "data-testid": "offline-banner" }),
    }));
    vi.doMock("@/components/update-notice-banner", () => ({
      UpdateNoticeBanner: () => null,
    }));
    vi.doMock("@/components/mobile-menu", () => ({
      MobileMenu: () => createElement("button", { type: "button" }, "Menu"),
    }));
    const { Header } = await import("@/components/header");
    const div = document.createElement("div");
    document.body.appendChild(div);
    const root = ReactDOM.createRoot(div);
    try {
      flushSync(() => {
        root.render(<Header locale="en" />);
      });
      await Promise.resolve();
      const headerEl = document.querySelector("header");
      expect(headerEl).toBeTruthy();
    } finally {
      flushSync(() => {
        root.unmount();
      });
      div.remove();
    }
  });
});
