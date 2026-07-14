"use client";

import { KeyRound, Loader2, UserPlus } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import * as React from "react";
import { PasswordVisibilityButton } from "@/components/auth/password-visibility-button";
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
import { authClient } from "@/lib/auth/client";
import {
  type AuthSocialProvider,
  isValidSocialUsername,
  submitSetup,
  submitSetupSocialContext,
} from "@/lib/auth/client-flow-utils";
import {
  isPasswordPolicyValid,
  PASSWORD_MIN_LENGTH,
} from "@/lib/password-policy";

interface InitialSetupFormProps {
  enabledSocialProviders: AuthSocialProvider[];
  safeNext: string | undefined;
  allowUnauthenticatedAccess: boolean;
  publicHomePath: string;
  externalErrorKey: string | null;
  onCompleted: (username: string) => void;
  onUnavailable: (errorKey: string) => void;
}

export function InitialSetupForm({
  enabledSocialProviders,
  safeNext,
  allowUnauthenticatedAccess,
  publicHomePath,
  externalErrorKey,
  onCompleted,
  onUnavailable,
}: InitialSetupFormProps) {
  const t = useTranslations("LoginPage");
  const formRef = React.useRef<HTMLFormElement>(null);
  const setupTokenId = React.useId();
  const displayNameId = React.useId();
  const usernameId = React.useId();
  const emailId = React.useId();
  const passwordId = React.useId();
  const [password, setPassword] = React.useState("");
  const [username, setUsername] = React.useState("");
  const [errorKey, setErrorKey] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [socialPendingProvider, setSocialPendingProvider] =
    React.useState<AuthSocialProvider | null>(null);
  const [showPassword, setShowPassword] = React.useState(false);

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
  const socialUsernameValid = isValidSocialUsername(username);
  const providerLabel: Record<AuthSocialProvider, string> = {
    github: t("social_provider_github"),
    google: t("social_provider_google"),
  };
  const visibleErrorKey = errorKey || externalErrorKey;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setErrorKey(null);

    try {
      const formData = new FormData(event.currentTarget);
      const token = String(formData.get("setupToken") || "").trim();
      const email = String(formData.get("email") || "")
        .trim()
        .toLowerCase();
      const submittedPassword = String(formData.get("password") || "");
      const name = String(formData.get("name") || "").trim();
      const submittedUsername = String(formData.get("username") || "").trim();
      const result = await submitSetup({
        token,
        email,
        password: submittedPassword,
        name,
        username: submittedUsername,
      });

      if (result === "unavailable") {
        onUnavailable("error_setup_unavailable");
        return;
      }
      if (result === "invalid_token") {
        setErrorKey("error_invalid_setup_token");
        return;
      }
      if (result !== "success") {
        setErrorKey(result.errorKey);
        return;
      }

      onCompleted(submittedUsername);
    } catch {
      setErrorKey("error_setup_failed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSocialSignIn = async (provider: AuthSocialProvider) => {
    if (submitting || socialPendingProvider) return;
    const form = formRef.current;
    if (!form) return;

    const token = (
      form.elements.namedItem("setupToken") as HTMLInputElement | null
    )?.value.trim();
    const name = (
      form.elements.namedItem("name") as HTMLInputElement | null
    )?.value.trim();
    const submittedUsername = (
      form.elements.namedItem("username") as HTMLInputElement | null
    )?.value.trim();
    if (!submittedUsername || !isValidSocialUsername(submittedUsername)) {
      setErrorKey("error_setup_invalid_username");
      return;
    }

    setErrorKey(null);
    setSocialPendingProvider(provider);
    try {
      const contextResult = await submitSetupSocialContext({
        token: token || "",
        provider,
        username: submittedUsername,
        name: name || "",
      });

      if (contextResult === "unavailable") {
        onUnavailable("error_setup_unavailable");
        return;
      }
      if (contextResult === "invalid_token") {
        setErrorKey("error_invalid_setup_token");
        return;
      }
      if (contextResult !== "success") {
        setErrorKey(contextResult.errorKey);
        return;
      }

      const result = await authClient.signIn.social({
        provider,
        ...(safeNext ? { callbackURL: safeNext } : {}),
      });
      if (result?.error) {
        setErrorKey("error_social_login_failed");
      }
    } catch {
      setErrorKey("error_setup_failed");
    } finally {
      setSocialPendingProvider(null);
    }
  };

  return (
    <form ref={formRef} onSubmit={handleSubmit}>
      <Card>
        <CardHeader>
          <CardTitle>{t("setup_title")}</CardTitle>
          <CardDescription>{t("setup_description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={setupTokenId}>{t("setup_token_label")}</Label>
            <Input
              id={setupTokenId}
              name="setupToken"
              type="password"
              placeholder={t("setup_token_placeholder")}
              required
              autoFocus
            />
          </div>
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
            <Label htmlFor={usernameId}>{t("setup_username_label")}</Label>
            <Input
              id={usernameId}
              name="username"
              type="text"
              placeholder={t("setup_username_placeholder")}
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
            />
            <p className="text-xs text-muted-foreground">
              {t("username_requirements")}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor={emailId}>{t("setup_email_label_optional")}</Label>
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
              <PasswordVisibilityButton
                visible={showPassword}
                showLabel={t("show_password")}
                hideLabel={t("hide_password")}
                onToggle={() => setShowPassword((previous) => !previous)}
              />
            </div>
            <p className={policyHintClass} aria-live="polite">
              {t("setup_password_requirements")}
            </p>
          </div>
          {visibleErrorKey && (
            <Alert variant="destructive">
              <KeyRound className="h-4 w-4" />
              <AlertDescription>{t(visibleErrorKey)}</AlertDescription>
            </Alert>
          )}
          {enabledSocialProviders.length > 0 && (
            <div className="space-y-2 pt-2">
              <div className="text-center text-sm text-muted-foreground">
                {t("alternative_login_divider")}
              </div>
              <SocialProviderList
                providers={enabledSocialProviders}
                pendingProvider={socialPendingProvider}
                disabled={() =>
                  submitting ||
                  Boolean(socialPendingProvider) ||
                  !socialUsernameValid
                }
                getLabel={(provider) =>
                  t("social_sign_in_button", {
                    provider: providerLabel[provider],
                  })
                }
                onSelect={(provider) => void handleSocialSignIn(provider)}
              />
            </div>
          )}
        </CardContent>
        <CardFooter className="flex-col gap-2">
          <Button
            type="submit"
            className="w-full"
            disabled={submitting || Boolean(socialPendingProvider)}
            aria-busy={submitting}
          >
            {submitting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <UserPlus className="mr-2 h-4 w-4" />
            )}
            {t("setup_button")}
          </Button>
          {allowUnauthenticatedAccess && (
            <Button type="button" variant="outline" className="w-full" asChild>
              <Link href={publicHomePath}>{t("continue_without_login")}</Link>
            </Button>
          )}
        </CardFooter>
      </Card>
    </form>
  );
}
