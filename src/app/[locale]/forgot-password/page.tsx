import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { Logo } from "@/components/logo";
import { normalizeLocale } from "@/i18n/config";
import { getCanonicalRoutePath } from "@/i18n/routing";
import { isAuthEmailDeliveryEnabled } from "@/lib/auth";
import { getAuthenticationMethod } from "@/lib/auth/mode";
import { redirectLocalized } from "@/lib/redirect-localized";

export default async function ForgotPasswordPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const appLocale = normalizeLocale(locale);
  if (getAuthenticationMethod() === "External") {
    redirectLocalized("/", appLocale);
  }
  const loginPath = `/${appLocale}${getCanonicalRoutePath("/login", appLocale)}`;
  const resetPath = `/${appLocale}${getCanonicalRoutePath("/reset-password", appLocale)}`;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <ForgotPasswordForm
          emailEnabled={isAuthEmailDeliveryEnabled()}
          loginPath={loginPath}
          resetPath={resetPath}
        />
      </div>
    </main>
  );
}
