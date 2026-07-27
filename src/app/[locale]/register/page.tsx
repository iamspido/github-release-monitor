import { getTranslations } from "next-intl/server";
import { RegisterForm } from "@/components/auth/register-form";
import { Logo } from "@/components/logo";
import { normalizeLocale } from "@/i18n/config";
import { getCanonicalRoutePath } from "@/i18n/routing";
import { getAuthFeatureConfig } from "@/lib/auth/config";
import { getAuthenticationMethod } from "@/lib/auth/mode";
import { redirectLocalized } from "@/lib/redirect-localized";

export default async function RegisterPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const appLocale = normalizeLocale(locale);
  if (getAuthenticationMethod() === "External") {
    redirectLocalized("/", appLocale);
  }

  const t = await getTranslations({
    locale: appLocale,
    namespace: "RegisterPage",
  });
  const { signupEnabled, enabledSocialProviders } = getAuthFeatureConfig();

  if (!signupEnabled) {
    const loginPath = getCanonicalRoutePath("/login", appLocale);
    redirectLocalized(loginPath, appLocale);
  }

  const loginPath = getCanonicalRoutePath("/login", appLocale);
  const loginHref =
    loginPath === "/" ? `/${appLocale}` : `/${appLocale}${loginPath}`;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-4">
          <Logo />
          <h1 className="text-2xl font-bold tracking-tight text-center">
            {t("title")}
          </h1>
        </div>
        <RegisterForm
          loginPath={loginHref}
          enabledSocialProviders={enabledSocialProviders}
        />
      </div>
    </main>
  );
}
