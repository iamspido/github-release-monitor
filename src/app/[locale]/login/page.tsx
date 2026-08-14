import { getTranslations } from "next-intl/server";

import { LoginForm } from "@/components/auth/login-form";
import { Logo } from "@/components/logo";
import { normalizeLocale } from "@/i18n/config";
import { getCanonicalRoutePath } from "@/i18n/routing";
import { getAuthFeatureConfig } from "@/lib/auth/config";
import { getAuthenticationMethod } from "@/lib/auth/mode";
import { redirectLocalized } from "@/lib/redirect-localized";

export default async function LoginPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const appLocale = normalizeLocale(locale);
  const authenticationMethod = getAuthenticationMethod();
  if (authenticationMethod === "External") {
    redirectLocalized("/", appLocale);
  }

  const t = await getTranslations({
    locale: appLocale,
    namespace: "LoginPage",
  });
  const { enabledSocialProviders, passkeyEnabled, signupEnabled } =
    getAuthFeatureConfig();
  const registerPath = getCanonicalRoutePath("/register", appLocale);
  const registerHref =
    registerPath === "/" ? `/${appLocale}` : `/${appLocale}${registerPath}`;
  const publicHomeHref = `/${appLocale}`;
  const forgotPasswordPath = getCanonicalRoutePath(
    "/forgot-password",
    appLocale,
  );
  const forgotPasswordHref = `/${appLocale}${forgotPasswordPath}`;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-4">
          <Logo />
          <h1 className="text-2xl font-bold tracking-tight text-center">
            {t("title")}
          </h1>
        </div>
        <LoginForm
          locale={appLocale}
          enabledSocialProviders={enabledSocialProviders}
          passkeyEnabled={passkeyEnabled}
          signupEnabled={signupEnabled}
          registerPath={registerHref}
          forgotPasswordPath={forgotPasswordHref}
          allowUnauthenticatedAccess={
            authenticationMethod === "AllowUnauthenticated"
          }
          publicHomePath={publicHomeHref}
        />
      </div>
    </main>
  );
}
