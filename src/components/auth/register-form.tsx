"use client";

import { Eye, EyeOff, Loader2, LogIn, UserPlus } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { register } from "@/app/auth/actions";
import { GoogleSignInButton } from "@/components/google-sign-in-button";
import { GithubBrandIcon } from "@/components/icons/simple-brand-icon";
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
import { authClient } from "@/lib/auth-client";
import {
  isPasswordPolicyValid,
  PASSWORD_MIN_LENGTH,
} from "@/lib/password-policy";
import { isUsernamePolicyValid } from "@/lib/username-policy";

type SocialProvider = "github" | "google";

interface RegisterFormProps {
  loginPath: string;
  enabledSocialProviders: SocialProvider[];
}

function mapOauthErrorToMessageKey(errorCode: string | null): string | null {
  if (!errorCode) return null;

  const normalized = errorCode.trim().toLowerCase();
  if (!normalized) return null;

  const oauthErrorMap: Record<string, string> = {
    signup_disabled: "error_social_signup_disabled",
    unable_to_link_account: "error_social_signup_disabled",
    user_not_found: "error_social_signup_disabled",
    oauth_provider_not_found: "error_social_provider_not_found",
    state_mismatch: "error_social_state_mismatch",
    state_not_found: "error_social_state_mismatch",
    account_already_linked_to_different_user:
      "error_social_account_linked_elsewhere",
  };

  return oauthErrorMap[normalized] || "error_social_login_failed";
}

function normalizeApiErrorCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

async function readApiErrorCode(response: Response): Promise<string | null> {
  try {
    const data = (await response.clone().json()) as {
      error?: unknown;
      code?: unknown;
    };
    return (
      normalizeApiErrorCode(data.error) || normalizeApiErrorCode(data.code)
    );
  } catch {
    return null;
  }
}

function mapRegisterSocialPrecheckErrorToMessageKey(errorCode: string | null) {
  if (!errorCode) return "error_social_login_failed";

  const errorMap: Record<string, string> = {
    signup_disabled: "error_setup_unavailable",
    invalid_username: "error_setup_invalid_username",
    invalid_email: "error_setup_invalid_email",
    username_in_use: "error_setup_username_in_use",
    email_in_use: "error_setup_email_in_use",
    provider_not_configured: "error_setup_provider_not_configured",
    invalid_provider: "error_setup_invalid_provider",
  };

  return errorMap[errorCode] || "error_social_login_failed";
}

function isValidSocialUsername(value: string) {
  return isUsernamePolicyValid(value.trim());
}

function RegisterButton() {
  const { pending } = useFormStatus();
  const t = useTranslations("RegisterPage");

  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <UserPlus className="mr-2 h-4 w-4" />
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
  const [password, setPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
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

  const trimmedPassword = password.trim();
  const passwordTouched = trimmedPassword.length > 0;
  const passwordPolicyMet = isPasswordPolicyValid(trimmedPassword);
  const passwordInputClass = [
    "pr-10",
    passwordTouched
      ? passwordPolicyMet
        ? "border-emerald-500 focus-visible:ring-emerald-500"
        : "border-destructive focus-visible:ring-destructive"
      : "",
  ]
    .filter(Boolean)
    .join(" ");
  const policyHintClass = [
    "text-xs",
    passwordTouched
      ? passwordPolicyMet
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-destructive"
      : "text-muted-foreground",
  ]
    .filter(Boolean)
    .join(" ");
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
      if (!isValidSocialUsername(username)) {
        setClientErrorKey("error_setup_invalid_username");
        return;
      }

      const precheckResponse = await fetch(
        "/api/auth/register/social-precheck",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            provider,
            username,
            email,
          }),
        },
      );

      if (!precheckResponse.ok) {
        const errorCode = await readApiErrorCode(precheckResponse);
        setClientErrorKey(
          mapRegisterSocialPrecheckErrorToMessageKey(errorCode),
        );
        return;
      }

      const precheckData = (await precheckResponse.json()) as {
        canProceed?: unknown;
        error?: unknown;
      };
      if (precheckData.canProceed !== true) {
        const errorCode = normalizeApiErrorCode(precheckData.error);
        setClientErrorKey(
          mapRegisterSocialPrecheckErrorToMessageKey(errorCode),
        );
        return;
      }

      const result = await authClient.signIn.social({
        provider,
      });
      if (result?.error) {
        setClientErrorKey("error_social_login_failed");
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
          <div className="space-y-2">
            <Label htmlFor={passwordId}>{t("password_label")}</Label>
            <div className="relative">
              <Input
                id={passwordId}
                name="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={t("password_placeholder")}
                autoComplete="new-password"
                minLength={PASSWORD_MIN_LENGTH}
                className={passwordInputClass}
                required
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={
                  showPassword ? t("hide_password") : t("show_password")
                }
                title={showPassword ? t("hide_password") : t("show_password")}
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </Button>
            </div>
            <p className={policyHintClass} aria-live="polite">
              {t("password_requirements")}
            </p>
          </div>
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
              {enabledSocialProviders.map((provider) => {
                const isPending = socialPendingProvider === provider;
                const isDisabled =
                  Boolean(socialPendingProvider) || !hasUsernameForSocial;
                const buttonLabel = tLogin("social_sign_in_button", {
                  provider: providerLabel[provider],
                });

                if (provider === "google") {
                  return (
                    <GoogleSignInButton
                      key={provider}
                      label={buttonLabel}
                      disabled={isDisabled}
                      pending={isPending}
                      onClick={() => void handleSocialSignUp(provider)}
                    />
                  );
                }

                return (
                  <Button
                    key={provider}
                    type="button"
                    variant="outline"
                    className="w-full"
                    disabled={isDisabled}
                    onClick={() => void handleSocialSignUp(provider)}
                    aria-busy={isPending}
                  >
                    {isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <GithubBrandIcon className="mr-2 h-4 w-4" />
                    )}
                    {buttonLabel}
                  </Button>
                );
              })}
            </div>
          )}
        </CardContent>
        <CardFooter className="flex-col gap-2">
          <RegisterButton />
          <Button type="button" variant="outline" className="w-full" asChild>
            <Link href={loginPath}>
              <LogIn className="mr-2 h-4 w-4" />
              {t("back_to_login_button")}
            </Link>
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
