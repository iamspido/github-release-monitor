"use client";

import {
  Eye,
  EyeOff,
  Fingerprint,
  KeyRound,
  Loader2,
  LogIn,
  UserPlus,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import * as React from "react";
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

interface LoginFormProps {
  locale: string;
  enabledSocialProviders: SocialProvider[];
  passkeyEnabled: boolean;
  signupEnabled: boolean;
  registerPath: string;
}

type PasswordLoginState = {
  errorKey?: string;
  requiresTwoFactor?: boolean;
  redirectTo?: string;
};

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

function isSocialErrorKey(errorKey: string | null) {
  return Boolean(errorKey?.startsWith("error_social_"));
}

function isValidSocialUsername(value: string) {
  return isUsernamePolicyValid(value.trim());
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

function mapSetupApiErrorToMessageKey(errorCode: string | null) {
  if (!errorCode) return "error_setup_failed";

  const errorMap: Record<string, string> = {
    invalid_setup_token: "error_invalid_setup_token",
    invalid_json: "error_setup_invalid_payload",
    invalid_input: "error_setup_invalid_input",
    invalid_email: "error_setup_invalid_email",
    invalid_username: "error_setup_invalid_username",
    invalid_password_policy: "error_setup_invalid_password_policy",
    email_already_exists: "error_setup_email_in_use",
    user_already_exists: "error_setup_email_in_use",
    username_already_exists: "error_setup_username_in_use",
    provider_not_configured: "error_setup_provider_not_configured",
    invalid_provider: "error_setup_invalid_provider",
  };

  return errorMap[errorCode] || "error_setup_failed";
}

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
        const response = await fetch("/api/auth/setup", {
          method: "GET",
          cache: "no-store",
        });
        if (!active) return;
        setSetupRequired(response.ok);
      } catch {
        if (!active) return;
        setSetupRequired(false);
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
      const response = await fetch("/api/login/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          identifier,
          password,
          next: safeNext,
          locale,
        }),
      });
      const data = (await response
        .json()
        .catch(() => ({}))) as PasswordLoginState;
      if (!response.ok) {
        setPasswordLoginState({
          errorKey: data.errorKey || "error_invalid_credentials",
        });
        return;
      }
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

      const precheckResponse = await fetch("/api/auth/social/precheck", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          identifier: normalizedIdentifier,
          provider,
        }),
      });

      if (precheckResponse.status === 400) {
        setClientErrorKey("error_social_identifier_required");
        return;
      }
      if (!precheckResponse.ok) {
        setClientErrorKey("error_social_login_failed");
        return;
      }

      const precheckData = (await precheckResponse.json()) as {
        canProceed?: unknown;
      };
      if (precheckData.canProceed !== true) {
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

      const response = await fetch("/api/auth/setup", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          token,
          email,
          password,
          name,
          username,
        }),
      });

      if (response.status === 404) {
        setSetupRequired(false);
        setSetupErrorKey("error_setup_unavailable");
        return;
      }

      if (response.status === 401) {
        setSetupErrorKey("error_invalid_setup_token");
        return;
      }

      if (!response.ok) {
        const errorCode = await readApiErrorCode(response);
        setSetupErrorKey(mapSetupApiErrorToMessageKey(errorCode));
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
      const response = await fetch("/api/auth/setup/social-context", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token,
          provider,
          username,
          name,
        }),
      });

      if (response.status === 404) {
        setSetupRequired(false);
        setSetupErrorKey("error_setup_unavailable");
        return;
      }
      if (response.status === 401) {
        setSetupErrorKey("error_invalid_setup_token");
        return;
      }
      if (!response.ok) {
        const errorCode = await readApiErrorCode(response);
        setSetupErrorKey(mapSetupApiErrorToMessageKey(errorCode));
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
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2"
                  onClick={() => setShowSetupPassword((prev) => !prev)}
                  aria-label={
                    showSetupPassword ? t("hide_password") : t("show_password")
                  }
                  title={
                    showSetupPassword ? t("hide_password") : t("show_password")
                  }
                >
                  {showSetupPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </Button>
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
                {enabledSocialProviders.map((provider) => {
                  const isPending = setupSocialPendingProvider === provider;
                  const isDisabled =
                    setupSubmitting ||
                    Boolean(setupSocialPendingProvider) ||
                    Boolean(socialPendingProvider) ||
                    !setupSocialUsernameValid;
                  const buttonLabel = t("social_sign_in_button", {
                    provider: providerLabel[provider],
                  });

                  if (provider === "google") {
                    return (
                      <GoogleSignInButton
                        key={provider}
                        label={buttonLabel}
                        disabled={isDisabled}
                        pending={isPending}
                        onClick={() => void handleSetupSocialSignIn(provider)}
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
                      onClick={() => void handleSetupSocialSignIn(provider)}
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
          <CardFooter>
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
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2"
                    onClick={() => setShowLoginPassword((prev) => !prev)}
                    aria-label={
                      showLoginPassword
                        ? t("hide_password")
                        : t("show_password")
                    }
                    title={
                      showLoginPassword
                        ? t("hide_password")
                        : t("show_password")
                    }
                  >
                    {showLoginPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </Button>
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
                    {enabledSocialProviders.map((provider) => {
                      const isPending = socialPendingProvider === provider;
                      const isDisabled =
                        Boolean(socialPendingProvider) ||
                        passkeyPending ||
                        !loginSocialUsernameValid;
                      const buttonLabel = t("social_sign_in_button", {
                        provider: providerLabel[provider],
                      });

                      if (provider === "google") {
                        return (
                          <GoogleSignInButton
                            key={provider}
                            label={buttonLabel}
                            disabled={isDisabled}
                            pending={isPending}
                            onClick={() => void handleSocialSignIn(provider)}
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
                          onClick={() => void handleSocialSignIn(provider)}
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
            </div>
          )}
        </CardFooter>
      </Card>
    </form>
  );
}
