"use client";

import { Loader2, LogIn, UserPlus } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { register } from "@/app/auth/actions";
import { NewPasswordField } from "@/components/auth/new-password-field";
import { SocialProviderList } from "@/components/auth/social-provider-list";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  type AuthSocialProvider,
  isValidSocialUsername,
  mapOauthErrorToMessageKey,
} from "@/lib/auth/client-flow-utils";
import { startRegistrationSocialFlow } from "@/lib/auth/client-social-flow";

type SocialProvider = AuthSocialProvider;

interface RegisterFormProps {
  loginPath: string;
  enabledSocialProviders: SocialProvider[];
}

function RegisterButton() {
  const { pending } = useFormStatus();
  const t = useTranslations("RegisterPage");

  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? (
        <Loader2 className="me-2 h-4 w-4 animate-spin" />
      ) : (
        <UserPlus className="me-2 h-4 w-4" />
      )}
      {t("register_button")}
    </Button>
  );
}

export function RegisterForm({
  loginPath,
  enabledSocialProviders,
}: RegisterFormProps) {
  const [state, formAction] = useActionState(register, undefined);
  const formRef = React.useRef<HTMLFormElement>(null);
  const [username, setUsername] = React.useState("");
  const [socialPendingProvider, setSocialPendingProvider] =
    React.useState<SocialProvider | null>(null);
  const [clientErrorKey, setClientErrorKey] = React.useState<string | null>(
    null,
  );
  const t = useTranslations("RegisterPage");
  const tLogin = useTranslations("LoginPage");
  const searchParams = useSearchParams();
  const oauthErrorCode = searchParams.get("error");
  const oauthErrorKey = React.useMemo(
    () => mapOauthErrorToMessageKey(oauthErrorCode),
    [oauthErrorCode],
  );
  const displayNameId = React.useId();
  const usernameId = React.useId();
  const emailId = React.useId();
  const passwordId = React.useId();

  const hasUsernameForSocial = isValidSocialUsername(username);
  const providerLabel: Record<SocialProvider, string> = {
    github: tLogin("social_provider_github"),
    google: tLogin("social_provider_google"),
  };
  const errorKey = clientErrorKey || state?.errorKey || oauthErrorKey;
  const errorMessage = errorKey
    ? errorKey.startsWith("error_setup_") ||
      errorKey === "error_invalid_setup_token" ||
      errorKey.startsWith("error_social_")
      ? tLogin(errorKey)
      : t(errorKey)
    : null;

  const handleSocialSignUp = async (provider: SocialProvider) => {
    if (socialPendingProvider) return;
    setClientErrorKey(null);
    setSocialPendingProvider(provider);
    try {
      const form = formRef.current;
      if (!form) {
        setClientErrorKey("error_social_login_failed");
        return;
      }

      const formData = new FormData(form);
      const username = String(formData.get("username") || "").trim();
      const email = String(formData.get("email") || "")
        .trim()
        .toLowerCase();
      const result = await startRegistrationSocialFlow({
        provider,
        username,
        email,
      });
      if (result.status === "error") {
        setClientErrorKey(result.errorKey);
      }
    } catch {
      setClientErrorKey("error_social_login_failed");
    } finally {
      setSocialPendingProvider(null);
    }
  };

  return (
    <form ref={formRef} action={formAction}>
      <Card>
        <CardHeader>
          <CardTitle>{t("form_title")}</CardTitle>
          <CardDescription>{t("form_description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={displayNameId}>{t("display_name_label")}</Label>
            <Input
              id={displayNameId}
              name="name"
              type="text"
              placeholder={t("display_name_placeholder")}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={usernameId}>{t("username_label")}</Label>
            <Input
              id={usernameId}
              dir="ltr"
              name="username"
              type="text"
              placeholder={t("username_placeholder")}
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              {t("username_requirements")}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor={emailId}>{t("email_label")}</Label>
            <Input
              id={emailId}
              name="email"
              type="email"
              placeholder={t("email_placeholder")}
              autoComplete="email"
              required
            />
          </div>
          <NewPasswordField
            id={passwordId}
            label={t("password_label")}
            placeholder={t("password_placeholder")}
            requirements={t("password_requirements")}
            showLabel={t("show_password")}
            hideLabel={t("hide_password")}
          />
          {errorMessage && (
            <Alert variant="destructive">
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          )}
          {enabledSocialProviders.length > 0 && (
            <div className="space-y-2 pt-2">
              <div className="text-center text-sm text-muted-foreground">
                {tLogin("alternative_login_divider")}
              </div>
              <SocialProviderList
                providers={enabledSocialProviders}
                pendingProvider={socialPendingProvider}
                disabled={() =>
                  Boolean(socialPendingProvider) || !hasUsernameForSocial
                }
                getLabel={(provider) =>
                  tLogin("social_sign_in_button", {
                    provider: providerLabel[provider],
                  })
                }
                onSelect={(provider) => void handleSocialSignUp(provider)}
              />
            </div>
          )}
        </CardContent>
        <CardFooter className="flex-col gap-2">
          <RegisterButton />
          <Button type="button" variant="outline" className="w-full" asChild>
            <Link href={loginPath}>
              <LogIn className="me-2 h-4 w-4 rtl:scale-x-[-1]" />
              {t("back_to_login_button")}
            </Link>
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
