import { getTranslations } from "next-intl/server";
import { RegisterForm } from "@/components/auth/register-form";
import { Logo } from "@/components/logo";
import { pathnames } from "@/i18n/routing";
import { getAuthenticationMethod } from "@/lib/auth/mode";
import { redirectLocalized } from "@/lib/redirect-localized";

export default async function RegisterPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (getAuthenticationMethod() === "External") {
    redirectLocalized("/", locale);
  }

  const t = await getTranslations({ locale, namespace: "RegisterPage" });
  const signupEnabled = process.env.AUTH_ENABLE_SIGNUP === "true";
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

  if (!signupEnabled) {
    const loginPath = pathnames["/login"][locale as "en" | "de"];
    redirectLocalized(loginPath, locale);
  }

  const loginPath = pathnames["/login"][locale as "en" | "de"];
  const loginHref = loginPath === "/" ? `/${locale}` : `/${locale}${loginPath}`;

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
