"use client";

import { Fingerprint, KeyRound, Loader2, LogIn } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import * as React from "react";
import { InitialSetupForm } from "@/components/auth/initial-setup-form";
import { PasswordVisibilityButton } from "@/components/auth/password-visibility-button";
import { SocialProviderList } from "@/components/auth/social-provider-list";
import { useSetupRequirement } from "@/components/auth/use-setup-requirement";
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
import type { Locale } from "@/i18n/config";
import { authClient } from "@/lib/auth/client";
import {
  type AuthSocialProvider,
  isSocialErrorKey,
  isValidSocialUsername,
  mapOauthErrorToMessageKey,
  navigateToClientPath,
  normalizeOptionalSafeRelativePath,
  submitPasswordLogin,
} from "@/lib/auth/client-flow-utils";
import { startLoginSocialFlow } from "@/lib/auth/client-social-flow";

type SocialProvider = AuthSocialProvider;

interface LoginFormProps {
  locale: Locale;
  enabledSocialProviders: SocialProvider[];
  passkeyEnabled: boolean;
  signupEnabled: boolean;
  registerPath: string;
  forgotPasswordPath?: string;
  allowUnauthenticatedAccess?: boolean;
  publicHomePath?: string;
}

type PasswordLoginState = {
  errorKey?: string;
  requiresTwoFactor?: boolean;
  redirectTo?: string;
};

function LoginButton({ pending }: { pending: boolean }) {
  const t = useTranslations("LoginPage");

  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? (
        <Loader2 className="me-2 h-4 w-4 animate-spin" />
      ) : (
        <LogIn className="me-2 h-4 w-4 rtl:scale-x-[-1]" />
      )}
      {t("login_button")}
    </Button>
  );
}

export function LoginForm({
  locale,
  enabledSocialProviders,
  passkeyEnabled,
  signupEnabled,
  registerPath,
  forgotPasswordPath = "/en/forgot-password",
  allowUnauthenticatedAccess = false,
  publicHomePath = "/",
}: LoginFormProps) {
  const [passwordLoginState, setPasswordLoginState] =
    React.useState<PasswordLoginState | null>(null);
  const { setupLoading, setupRequired, setSetupRequired } =
    useSetupRequirement();
  const [setupErrorKey, setSetupErrorKey] = React.useState<string | null>(null);
  const [setupCompleted, setSetupCompleted] = React.useState(false);
  const [loginIdentifier, setLoginIdentifier] = React.useState("");
  const [clientErrorKey, setClientErrorKey] = React.useState<string | null>(
    null,
  );
  const [socialIdentifier, setSocialIdentifier] = React.useState("");
  const [socialPendingProvider, setSocialPendingProvider] =
    React.useState<SocialProvider | null>(null);
  const [passkeyPending, setPasskeyPending] = React.useState(false);
  const [passwordLoginPending, setPasswordLoginPending] = React.useState(false);
  const [twoFactorPending, setTwoFactorPending] = React.useState(false);
  const [twoFactorCode, setTwoFactorCode] = React.useState("");
  const [showLoginPassword, setShowLoginPassword] = React.useState(false);
  const t = useTranslations("LoginPage");
  const tForgotPassword = useTranslations("ForgotPasswordPage");
  const searchParams = useSearchParams();
  const next = searchParams.get("next");
  const oauthErrorCode = searchParams.get("error");
  const signupSuccess = searchParams.get("registered") === "1";
  const oauthErrorKey = React.useMemo(
    () => mapOauthErrorToMessageKey(oauthErrorCode),
    [oauthErrorCode],
  );
  const safeNext = React.useMemo(
    () => normalizeOptionalSafeRelativePath(next),
    [next],
  );

  const formRef = React.useRef<HTMLFormElement>(null);
  const identifierRef = React.useRef<HTMLInputElement>(null);
  const identifierId = React.useId();
  const passwordId = React.useId();
  const socialIdentifierId = React.useId();
  const twoFactorCodeId = React.useId();

  React.useEffect(() => {
    if (passwordLoginState?.errorKey) {
      if (formRef.current) {
        const passwordInput = formRef.current.elements.namedItem(
          "password",
        ) as HTMLInputElement;
        if (passwordInput) {
          passwordInput.value = "";
        }
      }
      identifierRef.current?.focus();
    }
  }, [passwordLoginState]);

  React.useEffect(() => {
    if (!passwordLoginState?.redirectTo) return;
    navigateToClientPath(passwordLoginState.redirectTo);
  }, [passwordLoginState?.redirectTo]);

  const errorKey =
    setupErrorKey ||
    clientErrorKey ||
    passwordLoginState?.errorKey ||
    oauthErrorKey;
  const requiresTwoFactor = Boolean(passwordLoginState?.requiresTwoFactor);
  const hasAlternativeAuthOptions =
    !requiresTwoFactor && (enabledSocialProviders.length > 0 || passkeyEnabled);
  const showSocialErrorInAlternativeSection = Boolean(
    errorKey &&
      isSocialErrorKey(errorKey) &&
      hasAlternativeAuthOptions &&
      enabledSocialProviders.length > 0,
  );
  const formErrorKey = showSocialErrorInAlternativeSection ? null : errorKey;
  const socialErrorKey = showSocialErrorInAlternativeSection ? errorKey : null;
  const providerLabel: Record<SocialProvider, string> = {
    github: t("social_provider_github"),
    google: t("social_provider_google"),
  };
  const loginSocialUsernameValid = isValidSocialUsername(socialIdentifier);

  const handlePasswordLoginSubmit = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    if (requiresTwoFactor || passwordLoginPending) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      // eslint-disable-next-line no-console
      console.warn("Login prevented: offline");
      return;
    }

    setPasswordLoginPending(true);
    setClientErrorKey(null);
    setPasswordLoginState(null);

    try {
      const form = event.currentTarget;
      const formData = new FormData(form);
      const identifier = String(formData.get("email") || "");
      const password = String(formData.get("password") || "");
      const data = await submitPasswordLogin({
        identifier,
        password,
        next: safeNext,
        locale,
      });
      setPasswordLoginState(data);
    } catch {
      setPasswordLoginState({ errorKey: "error_invalid_credentials" });
    } finally {
      setPasswordLoginPending(false);
    }
  };

  const handleSocialSignIn = async (provider: SocialProvider) => {
    if (socialPendingProvider || passkeyPending) return;
    setClientErrorKey(null);
    setSocialPendingProvider(provider);

    try {
      const result = await startLoginSocialFlow({
        identifier: socialIdentifier,
        provider,
        callbackURL: safeNext,
      });
      if (result.status === "unavailable") {
        setClientErrorKey("error_social_login_unavailable");
        return;
      }
      if (result.status === "error") {
        setClientErrorKey(result.errorKey);
      }
    } catch {
      setClientErrorKey("error_social_login_failed");
    } finally {
      setSocialPendingProvider(null);
    }
  };

  const handlePasskeySignIn = async () => {
    if (socialPendingProvider || passkeyPending) return;
    setClientErrorKey(null);
    setPasskeyPending(true);

    try {
      const result = await authClient.signIn.passkey();
      if (result.error) {
        // eslint-disable-next-line no-console
        console.warn("Passkey sign-in failed", result.error);
        setClientErrorKey("error_passkey_login_failed");
        return;
      }
      navigateToClientPath(safeNext || "/");
    } catch {
      setClientErrorKey("error_passkey_login_failed");
    } finally {
      setPasskeyPending(false);
    }
  };

  const handleTwoFactorVerify = async () => {
    if (!requiresTwoFactor || twoFactorPending) return;
    setClientErrorKey(null);
    setTwoFactorPending(true);
    try {
      const result = await authClient.twoFactor.verifyTotp({
        code: twoFactorCode.trim(),
        trustDevice: true,
      });
      if (result.error) {
        setClientErrorKey("error_two_factor_invalid");
        return;
      }
      navigateToClientPath(safeNext || "/");
    } catch {
      setClientErrorKey("error_two_factor_invalid");
    } finally {
      setTwoFactorPending(false);
    }
  };

  if (setupLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("form_title")}</CardTitle>
          <CardDescription>{t("form_description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-6 text-muted-foreground">
            <Loader2 className="me-2 h-4 w-4 animate-spin" />
            <span>{t("checking_setup")}</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (setupRequired) {
    return (
      <InitialSetupForm
        enabledSocialProviders={enabledSocialProviders}
        safeNext={safeNext}
        allowUnauthenticatedAccess={allowUnauthenticatedAccess}
        publicHomePath={publicHomePath}
        externalErrorKey={errorKey}
        onUnavailable={(nextErrorKey) => {
          setSetupRequired(false);
          setSetupErrorKey(nextErrorKey);
        }}
        onCompleted={(username) => {
          setSetupRequired(false);
          setSetupCompleted(true);
          setSetupErrorKey(null);
          setLoginIdentifier(username);
          requestAnimationFrame(() => identifierRef.current?.focus());
        }}
      />
    );
  }

  return (
    <form
      ref={formRef}
      onSubmit={(event) => {
        if (requiresTwoFactor) {
          event.preventDefault();
          return;
        }
        void handlePasswordLoginSubmit(event);
      }}
    >
      <Card>
        <CardHeader>
          <CardTitle>{t("form_title")}</CardTitle>
          <CardDescription>{t("form_description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {next && <input type="hidden" name="next" value={next} />}
          {setupCompleted && (
            <Alert>
              <AlertDescription>
                {t("setup_success_login_now")}
              </AlertDescription>
            </Alert>
          )}
          {signupSuccess && (
            <Alert>
              <AlertDescription>
                {t("signup_success_login_now")}
              </AlertDescription>
            </Alert>
          )}
          {requiresTwoFactor ? (
            <div className="space-y-2">
              <Alert>
                <AlertDescription>
                  {t("two_factor_login_prompt")}
                </AlertDescription>
              </Alert>
              <Label htmlFor={twoFactorCodeId}>
                {t("two_factor_login_code_label")}
              </Label>
              <Input
                id={twoFactorCodeId}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={8}
                value={twoFactorCode}
                onChange={(event) => setTwoFactorCode(event.target.value)}
                placeholder={t("two_factor_login_code_placeholder")}
                autoFocus
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void handleTwoFactorVerify();
                  }
                }}
              />
            </div>
          ) : (
            <>
              <div className="space-y-3">
                <Label htmlFor={identifierId}>{t("identifier_label")}</Label>
                <Input
                  id={identifierId}
                  name="email"
                  dir="ltr"
                  type="text"
                  placeholder={t("identifier_placeholder")}
                  autoComplete="username webauthn"
                  required
                  autoFocus
                  ref={identifierRef}
                  value={loginIdentifier}
                  onChange={(event) => setLoginIdentifier(event.target.value)}
                />
              </div>
              <div className="space-y-3">
                <Label htmlFor={passwordId}>{t("password_label")}</Label>
                <div className="relative">
                  <Input
                    id={passwordId}
                    name="password"
                    dir="ltr"
                    type={showLoginPassword ? "text" : "password"}
                    placeholder={t("password_placeholder")}
                    autoComplete="current-password webauthn"
                    className="pe-10"
                    required
                  />
                  <PasswordVisibilityButton
                    visible={showLoginPassword}
                    showLabel={t("show_password")}
                    hideLabel={t("hide_password")}
                    onToggle={() => setShowLoginPassword((prev) => !prev)}
                  />
                </div>
                <div className="text-end">
                  <Link
                    href={forgotPasswordPath}
                    className="text-sm text-primary underline-offset-4 hover:underline"
                  >
                    {tForgotPassword("login_link")}
                  </Link>
                </div>
              </div>
            </>
          )}
          {formErrorKey && (
            <Alert variant="destructive">
              <KeyRound className="h-4 w-4" />
              <AlertDescription>{t(formErrorKey)}</AlertDescription>
            </Alert>
          )}
          {!requiresTwoFactor &&
            (enabledSocialProviders.length > 0 || passkeyEnabled) && (
              <div className="space-y-3 pt-1">
                <div className="text-center text-sm text-muted-foreground">
                  {t("alternative_login_divider")}
                </div>
                {passkeyEnabled && (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={() => void handlePasskeySignIn()}
                    disabled={Boolean(socialPendingProvider) || passkeyPending}
                    aria-busy={passkeyPending}
                  >
                    {passkeyPending ? (
                      <Loader2 className="me-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Fingerprint className="me-2 h-4 w-4" />
                    )}
                    {t("passkey_login_button")}
                  </Button>
                )}
                {enabledSocialProviders.length > 0 && (
                  <div
                    className={
                      passkeyEnabled
                        ? "space-y-3 border-t border-border/60 pt-3"
                        : "space-y-3"
                    }
                  >
                    {socialErrorKey && (
                      <Alert variant="destructive">
                        <KeyRound className="h-4 w-4" />
                        <AlertDescription>{t(socialErrorKey)}</AlertDescription>
                      </Alert>
                    )}
                    <div className="space-y-3">
                      <Label htmlFor={socialIdentifierId}>
                        {t("social_identifier_label")}
                      </Label>
                      <Input
                        id={socialIdentifierId}
                        name="socialIdentifier"
                        dir="ltr"
                        type="text"
                        autoComplete="username"
                        placeholder={t("social_identifier_placeholder")}
                        value={socialIdentifier}
                        onChange={(event) =>
                          setSocialIdentifier(event.target.value)
                        }
                        disabled={
                          Boolean(socialPendingProvider) || passkeyPending
                        }
                      />
                      <p className="text-xs text-muted-foreground">
                        {t("username_requirements")}
                      </p>
                    </div>
                    <SocialProviderList
                      providers={enabledSocialProviders}
                      pendingProvider={socialPendingProvider}
                      disabled={() =>
                        Boolean(socialPendingProvider) ||
                        passkeyPending ||
                        !loginSocialUsernameValid
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
              </div>
            )}
        </CardContent>
        <CardFooter>
          {requiresTwoFactor ? (
            <Button
              type="button"
              className="w-full"
              onClick={() => void handleTwoFactorVerify()}
              disabled={twoFactorPending || !twoFactorCode.trim()}
              aria-busy={twoFactorPending}
            >
              {twoFactorPending ? (
                <Loader2 className="me-2 h-4 w-4 animate-spin" />
              ) : (
                <KeyRound className="me-2 h-4 w-4" />
              )}
              {t("two_factor_login_verify_button")}
            </Button>
          ) : (
            <div className="w-full space-y-2">
              <LoginButton pending={passwordLoginPending} />
              {signupEnabled && (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  asChild
                >
                  <Link href={registerPath}>{t("register_button")}</Link>
                </Button>
              )}
              {allowUnauthenticatedAccess && (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  asChild
                >
                  <Link href={publicHomePath}>
                    {t("continue_without_login")}
                  </Link>
                </Button>
              )}
            </div>
          )}
        </CardFooter>
      </Card>
    </form>
  );
}
