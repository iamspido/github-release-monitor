import { getTranslations } from "next-intl/server";

import { LoginForm } from "@/components/auth/login-form";
import { Logo } from "@/components/logo";
import { pathnames } from "@/i18n/routing";
import { getAuthenticationMethod } from "@/lib/auth/mode";
import { redirectLocalized } from "@/lib/redirect-localized";

export default async function LoginPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const authenticationMethod = getAuthenticationMethod();
  if (authenticationMethod === "External") {
    redirectLocalized("/", locale);
  }

  const t = await getTranslations({ locale, namespace: "LoginPage" });
  const enabledSocialProviders: Array<"github" | "google"> = [];
  if (
    process.env.AUTH_GITHUB_CLIENT_ID?.trim() &&
    process.env.AUTH_GITHUB_CLIENT_SECRET?.trim()
  ) {
    enabledSocialProviders.push("github");
  }
  if (
    process.env.AUTH_GOOGLE_CLIENT_ID?.trim() &&
    process.env.AUTH_GOOGLE_CLIENT_SECRET?.trim()
  ) {
    enabledSocialProviders.push("google");
  }
  const passkeyEnabled = process.env.AUTH_ENABLE_PASSKEY !== "false";
  const signupEnabled = process.env.AUTH_ENABLE_SIGNUP === "true";
  const registerPath = pathnames["/register"][locale as "en" | "de"];
  const registerHref =
    registerPath === "/" ? `/${locale}` : `/${locale}${registerPath}`;
  const publicHomeHref = `/${locale}`;

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
          locale={locale}
          enabledSocialProviders={enabledSocialProviders}
          passkeyEnabled={passkeyEnabled}
          signupEnabled={signupEnabled}
          registerPath={registerHref}
          allowUnauthenticatedAccess={
            authenticationMethod === "AllowUnauthenticated"
          }
          publicHomePath={publicHomeHref}
        />
      </div>
    </main>
  );
}
