"use client";

import { Fingerprint, KeyRound, Loader2, LogIn, UserPlus } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
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
  checkSetupRequired,
  isSocialErrorKey,
  isValidSocialUsername,
  mapOauthErrorToMessageKey,
  precheckSocialLogin,
  submitPasswordLogin,
  submitSetup,
  submitSetupSocialContext,
} from "@/lib/auth/client-flow-utils";
import {
  isPasswordPolicyValid,
  PASSWORD_MIN_LENGTH,
} from "@/lib/password-policy";

type SocialProvider = AuthSocialProvider;

interface LoginFormProps {
  locale: string;
  enabledSocialProviders: SocialProvider[];
  passkeyEnabled: boolean;
  signupEnabled: boolean;
  registerPath: string;
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
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <LogIn className="mr-2 h-4 w-4" />
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
  allowUnauthenticatedAccess = false,
  publicHomePath = "/",
}: LoginFormProps) {
  const [passwordLoginState, setPasswordLoginState] =
    React.useState<PasswordLoginState | null>(null);
  const [setupRequired, setSetupRequired] = React.useState(false);
  const [setupLoading, setSetupLoading] = React.useState(true);
  const [setupErrorKey, setSetupErrorKey] = React.useState<string | null>(null);
  const [setupCompleted, setSetupCompleted] = React.useState(false);
  const [setupSubmitting, setSetupSubmitting] = React.useState(false);
  const [setupSocialPendingProvider, setSetupSocialPendingProvider] =
    React.useState<SocialProvider | null>(null);
  const [setupPassword, setSetupPassword] = React.useState("");
  const [setupUsername, setSetupUsername] = React.useState("");
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
  const [showSetupPassword, setShowSetupPassword] = React.useState(false);
  const [showLoginPassword, setShowLoginPassword] = React.useState(false);
  const t = useTranslations("LoginPage");
  const searchParams = useSearchParams();
  const next = searchParams.get("next");
  const oauthErrorCode = searchParams.get("error");
  const signupSuccess = searchParams.get("registered") === "1";
  const oauthErrorKey = React.useMemo(
    () => mapOauthErrorToMessageKey(oauthErrorCode),
    [oauthErrorCode],
  );
  const safeNext = React.useMemo(() => {
    if (!next) return undefined;
    if (!next.startsWith("/") || next.startsWith("//") || next.includes("..")) {
      return undefined;
    }
    return next;
  }, [next]);

  const formRef = React.useRef<HTMLFormElement>(null);
  const setupFormRef = React.useRef<HTMLFormElement>(null);
  const identifierRef = React.useRef<HTMLInputElement>(null);
  const identifierId = React.useId();
  const passwordId = React.useId();
  const socialIdentifierId = React.useId();
  const setupTokenId = React.useId();
  const displayNameId = React.useId();
  const setupUsernameId = React.useId();
  const twoFactorCodeId = React.useId();

  React.useEffect(() => {
    let active = true;
    (async () => {
      try {
        const isSetupRequired = await checkSetupRequired();
        if (!active) return;
        setSetupRequired(isSetupRequired);
      } finally {
        if (active) {
          setSetupLoading(false);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, []);

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
    window.location.assign(passwordLoginState.redirectTo);
  }, [passwordLoginState?.redirectTo]);

  const errorKey =
    setupErrorKey ||
    clientErrorKey ||
    passwordLoginState?.errorKey ||
    oauthErrorKey;
  const trimmedSetupPassword = setupPassword.trim();
  const setupPasswordTouched = trimmedSetupPassword.length > 0;
  const setupPasswordPolicyMet = isPasswordPolicyValid(trimmedSetupPassword);
  const setupPasswordInputClass = [
    "pr-10",
    setupPasswordTouched
      ? setupPasswordPolicyMet
        ? "border-emerald-500 focus-visible:ring-emerald-500"
        : "border-destructive focus-visible:ring-destructive"
      : "",
  ]
    .filter(Boolean)
    .join(" ");
  const setupPolicyHintClass = [
    "text-xs",
    setupPasswordTouched
      ? setupPasswordPolicyMet
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-destructive"
      : "text-muted-foreground",
  ]
    .filter(Boolean)
    .join(" ");
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
  const setupSocialUsernameValid = isValidSocialUsername(setupUsername);
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
      const normalizedIdentifier = socialIdentifier.trim();
      if (!normalizedIdentifier) {
        setClientErrorKey("error_social_identifier_required");
        return;
      }
      if (!isValidSocialUsername(normalizedIdentifier)) {
        setClientErrorKey("error_social_identifier_invalid");
        return;
      }

      const precheck = await precheckSocialLogin({
        identifier: normalizedIdentifier,
        provider,
      });

      if (precheck === "invalid_input") {
        setClientErrorKey("error_social_identifier_required");
        return;
      }
      if (precheck === "failed") {
        setClientErrorKey("error_social_login_failed");
        return;
      }
      if (precheck !== "allowed") {
        setClientErrorKey("error_social_login_unavailable");
        return;
      }

      const result = await authClient.signIn.social({
        provider,
        ...(safeNext ? { callbackURL: safeNext } : {}),
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
      window.location.assign(safeNext || "/");
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
      window.location.assign(safeNext || "/");
    } catch {
      setClientErrorKey("error_two_factor_invalid");
    } finally {
      setTwoFactorPending(false);
    }
  };

  const handleSetupSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (setupSubmitting) return;
    setSetupSubmitting(true);
    setSetupErrorKey(null);
    setClientErrorKey(null);

    try {
      const form = event.currentTarget;
      const formData = new FormData(form);
      const token = String(formData.get("setupToken") || "").trim();
      const email = String(formData.get("email") || "")
        .trim()
        .toLowerCase();
      const password = String(formData.get("password") || "");
      const name = String(formData.get("name") || "").trim();
      const username = String(formData.get("username") || "").trim();

      const result = await submitSetup({
        token,
        email,
        password,
        name,
        username,
      });

      if (result === "unavailable") {
        setSetupRequired(false);
        setSetupErrorKey("error_setup_unavailable");
        return;
      }

      if (result === "invalid_token") {
        setSetupErrorKey("error_invalid_setup_token");
        return;
      }

      if (result !== "success") {
        setSetupErrorKey(result.errorKey);
        return;
      }

      if (setupFormRef.current) {
        setupFormRef.current.reset();
      }
      setSetupPassword("");
      setSetupUsername("");
      setSetupRequired(false);
      setSetupCompleted(true);
      setSetupErrorKey(null);
      setLoginIdentifier(username);
      requestAnimationFrame(() => identifierRef.current?.focus());
    } catch {
      setSetupErrorKey("error_setup_failed");
    } finally {
      setSetupSubmitting(false);
    }
  };

  const handleSetupSocialSignIn = async (provider: SocialProvider) => {
    if (
      setupSubmitting ||
      setupSocialPendingProvider ||
      socialPendingProvider
    ) {
      return;
    }
    const form = setupFormRef.current;
    if (!form) return;

    const setupTokenInput = form.elements.namedItem(
      "setupToken",
    ) as HTMLInputElement | null;
    const setupNameInput = form.elements.namedItem(
      "name",
    ) as HTMLInputElement | null;
    const setupUsernameInput = form.elements.namedItem(
      "username",
    ) as HTMLInputElement | null;
    const token = setupTokenInput?.value.trim() || "";
    const name = setupNameInput?.value.trim() || "";
    const username = setupUsernameInput?.value.trim() || "";
    if (!isValidSocialUsername(username)) {
      setSetupErrorKey("error_setup_invalid_username");
      return;
    }

    setSetupErrorKey(null);
    setClientErrorKey(null);
    setSetupSocialPendingProvider(provider);

    try {
      const contextResult = await submitSetupSocialContext({
        token,
        provider,
        username,
        name,
      });

      if (contextResult === "unavailable") {
        setSetupRequired(false);
        setSetupErrorKey("error_setup_unavailable");
        return;
      }
      if (contextResult === "invalid_token") {
        setSetupErrorKey("error_invalid_setup_token");
        return;
      }
      if (contextResult !== "success") {
        setSetupErrorKey(contextResult.errorKey);
        return;
      }

      const result = await authClient.signIn.social({
        provider,
        ...(safeNext ? { callbackURL: safeNext } : {}),
      });
      if (result?.error) {
        setSetupErrorKey("error_social_login_failed");
      }
    } catch {
      setSetupErrorKey("error_setup_failed");
    } finally {
      setSetupSocialPendingProvider(null);
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
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            <span>{t("checking_setup")}</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (setupRequired) {
    return (
      <form ref={setupFormRef} onSubmit={handleSetupSubmit}>
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
              <Label htmlFor={setupUsernameId}>
                {t("setup_username_label")}
              </Label>
              <Input
                id={setupUsernameId}
                name="username"
                type="text"
                placeholder={t("setup_username_placeholder")}
                autoComplete="username"
                value={setupUsername}
                onChange={(event) => setSetupUsername(event.target.value)}
                required
              />
              <p className="text-xs text-muted-foreground">
                {t("username_requirements")}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor={identifierId}>
                {t("setup_email_label_optional")}
              </Label>
              <Input
                id={identifierId}
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
                  type={showSetupPassword ? "text" : "password"}
                  value={setupPassword}
                  onChange={(event) => setSetupPassword(event.target.value)}
                  placeholder={t("password_placeholder")}
                  autoComplete="new-password"
                  minLength={PASSWORD_MIN_LENGTH}
                  className={setupPasswordInputClass}
                  required
                />
                <PasswordVisibilityButton
                  visible={showSetupPassword}
                  showLabel={t("show_password")}
                  hideLabel={t("hide_password")}
                  onToggle={() => setShowSetupPassword((prev) => !prev)}
                />
              </div>
              <p className={setupPolicyHintClass} aria-live="polite">
                {t("setup_password_requirements")}
              </p>
            </div>
            {errorKey && (
              <Alert variant="destructive">
                <KeyRound className="h-4 w-4" />
                <AlertDescription>{t(errorKey)}</AlertDescription>
              </Alert>
            )}
            {enabledSocialProviders.length > 0 && (
              <div className="space-y-2 pt-2">
                <div className="text-center text-sm text-muted-foreground">
                  {t("alternative_login_divider")}
                </div>
                <SocialProviderList
                  providers={enabledSocialProviders}
                  pendingProvider={setupSocialPendingProvider}
                  disabled={() =>
                    setupSubmitting ||
                    Boolean(setupSocialPendingProvider) ||
                    Boolean(socialPendingProvider) ||
                    !setupSocialUsernameValid
                  }
                  getLabel={(provider) =>
                    t("social_sign_in_button", {
                      provider: providerLabel[provider],
                    })
                  }
                  onSelect={(provider) =>
                    void handleSetupSocialSignIn(provider)
                  }
                />
              </div>
            )}
          </CardContent>
          <CardFooter className="flex-col gap-2">
            <Button
              type="submit"
              className="w-full"
              disabled={setupSubmitting || Boolean(setupSocialPendingProvider)}
              aria-busy={setupSubmitting}
            >
              {setupSubmitting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <UserPlus className="mr-2 h-4 w-4" />
              )}
              {t("setup_button")}
            </Button>
            {allowUnauthenticatedAccess && (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                asChild
              >
                <Link href={publicHomePath}>{t("continue_without_login")}</Link>
              </Button>
            )}
          </CardFooter>
        </Card>
      </form>
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
                    type={showLoginPassword ? "text" : "password"}
                    placeholder={t("password_placeholder")}
                    autoComplete="current-password webauthn"
                    className="pr-10"
                    required
                  />
                  <PasswordVisibilityButton
                    visible={showLoginPassword}
                    showLabel={t("show_password")}
                    hideLabel={t("hide_password")}
                    onToggle={() => setShowLoginPassword((prev) => !prev)}
                  />
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
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Fingerprint className="mr-2 h-4 w-4" />
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
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <KeyRound className="mr-2 h-4 w-4" />
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
