"use client";

import {
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Mail,
  ShieldCheck,
  ShieldOff,
} from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";
import {
  updateAccountEmailAction,
  updateAccountPasswordAction,
} from "@/app/auth/settings-actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useNetworkStatus } from "@/hooks/use-network";
import { authClient } from "@/lib/auth-client";
import {
  isPasswordPolicyValid,
  PASSWORD_MIN_LENGTH,
} from "@/lib/password-policy";

interface AccountLike {
  provider?: string | { id?: string | null; name?: string | null } | null;
  providerId?: string | null;
}

function findAccountsArray(payload: unknown): AccountLike[] {
  if (Array.isArray(payload)) {
    return payload as AccountLike[];
  }
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const record = payload as Record<string, unknown>;
  const nestedCandidates: unknown[] = [
    record.data,
    record.accounts,
    record.result,
    record.response,
  ];
  for (const candidate of nestedCandidates) {
    if (Array.isArray(candidate)) {
      return candidate as AccountLike[];
    }
    if (candidate && typeof candidate === "object") {
      const nested = candidate as Record<string, unknown>;
      if (Array.isArray(nested.accounts)) {
        return nested.accounts as AccountLike[];
      }
      if (Array.isArray(nested.data)) {
        return nested.data as AccountLike[];
      }
    }
  }
  return [];
}

function toProviderId(value: AccountLike): string {
  const providerRaw =
    typeof value.provider === "string"
      ? value.provider
      : value.provider?.id || value.provider?.name || "";
  return String(value.providerId || providerRaw || "")
    .trim()
    .toLowerCase();
}

function hasCredentialProvider(payload: unknown): boolean {
  const accounts = findAccountsArray(payload);
  return accounts.some((account) => toProviderId(account) === "credential");
}

function isLikelyEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function AccountCredentialsSettingsCard() {
  const t = useTranslations("SettingsPage");
  const { isOnline } = useNetworkStatus();
  const sessionState = authClient.useSession();
  const sessionData = (sessionState as { data?: unknown }).data as
    | {
        user?: {
          email?: string | null;
        };
      }
    | undefined;
  const sessionLoading = Boolean(
    (sessionState as { isPending?: unknown }).isPending,
  );

  const [emailInput, setEmailInput] = React.useState("");
  const [emailPending, setEmailPending] = React.useState(false);
  const [emailErrorKey, setEmailErrorKey] = React.useState<string | null>(null);
  const [emailSuccessKey, setEmailSuccessKey] = React.useState<string | null>(
    null,
  );
  const [emailOverride, setEmailOverride] = React.useState<string | null>(null);

  const [accountsLoading, setAccountsLoading] = React.useState(true);
  const [hasPassword, setHasPassword] = React.useState(false);
  const [passwordPending, setPasswordPending] = React.useState(false);
  const [passwordErrorKey, setPasswordErrorKey] = React.useState<string | null>(
    null,
  );
  const [passwordSuccessKey, setPasswordSuccessKey] = React.useState<
    string | null
  >(null);
  const [currentPassword, setCurrentPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [showPasswords, setShowPasswords] = React.useState(false);

  const emailInputId = React.useId();
  const currentPasswordId = React.useId();
  const newPasswordId = React.useId();
  const confirmPasswordId = React.useId();

  const currentEmailFromSession =
    typeof sessionData?.user?.email === "string" ? sessionData.user.email : "";
  const passwordInputType = showPasswords ? "text" : "password";
  const passwordToggleLabel = showPasswords
    ? t("hide_password")
    : t("show_password");
  const currentEmail = (emailOverride ?? currentEmailFromSession ?? "").trim();
  const trimmedCurrentPassword = currentPassword.trim();
  const trimmedNewPassword = newPassword.trim();
  const trimmedConfirmPassword = confirmPassword.trim();
  const newPasswordTouched = trimmedNewPassword.length > 0;
  const confirmPasswordTouched = trimmedConfirmPassword.length > 0;
  const newPasswordPolicyMet = isPasswordPolicyValid(trimmedNewPassword);
  const passwordsMatch =
    trimmedNewPassword.length > 0 &&
    trimmedNewPassword === trimmedConfirmPassword;
  const currentPasswordRequirementMet =
    !hasPassword || trimmedCurrentPassword.length > 0;
  const currentPasswordMissingForChange =
    hasPassword &&
    (newPasswordTouched || confirmPasswordTouched) &&
    !currentPasswordRequirementMet;
  const newPasswordInputClass = [
    "pr-10",
    newPasswordTouched
      ? newPasswordPolicyMet
        ? "border-emerald-500 focus-visible:ring-emerald-500"
        : "border-destructive focus-visible:ring-destructive"
      : "",
  ]
    .filter(Boolean)
    .join(" ");
  const confirmPasswordInputClass = [
    "pr-10",
    confirmPasswordTouched
      ? passwordsMatch
        ? "border-emerald-500 focus-visible:ring-emerald-500"
        : "border-destructive focus-visible:ring-destructive"
      : "",
  ]
    .filter(Boolean)
    .join(" ");
  const policyHintClass = [
    "text-xs",
    newPasswordTouched
      ? newPasswordPolicyMet
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-destructive"
      : "text-muted-foreground",
  ]
    .filter(Boolean)
    .join(" ");
  const confirmHintClass = [
    "text-xs",
    confirmPasswordTouched
      ? passwordsMatch
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-destructive"
      : "text-muted-foreground",
  ]
    .filter(Boolean)
    .join(" ");
  const canSubmitEmail =
    isOnline &&
    !emailPending &&
    !sessionLoading &&
    emailInput.trim().length > 0 &&
    isLikelyEmail(emailInput.trim());
  const canSubmitPassword =
    isOnline &&
    !passwordPending &&
    !accountsLoading &&
    newPasswordPolicyMet &&
    passwordsMatch &&
    currentPasswordRequirementMet;

  React.useEffect(() => {
    let active = true;
    (async () => {
      try {
        const response = await authClient.listAccounts();
        if (!active) return;
        setHasPassword(hasCredentialProvider(response));
      } catch {
        if (!active) return;
        setHasPassword(false);
      } finally {
        if (active) {
          setAccountsLoading(false);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const handleUpdateEmail = async () => {
    if (!canSubmitEmail) return;
    setEmailPending(true);
    setEmailErrorKey(null);
    setEmailSuccessKey(null);
    try {
      const callbackURL =
        typeof window === "undefined" ? "/settings" : window.location.pathname;
      const result = await updateAccountEmailAction({
        newEmail: emailInput.trim(),
        callbackURL,
      });
      if (!result.ok) {
        setEmailErrorKey(result.errorKey || "account_email_update_failed");
        return;
      }
      const normalized = emailInput.trim().toLowerCase();
      if (result.mode === "updated") {
        setEmailOverride(normalized);
      }
      setEmailInput("");
      setEmailSuccessKey(
        result.mode === "verification_sent"
          ? "account_email_verification_sent"
          : "account_email_update_success",
      );
    } catch {
      setEmailErrorKey("account_email_update_failed");
    } finally {
      setEmailPending(false);
    }
  };

  const handleUpdatePassword = async () => {
    if (!canSubmitPassword) return;
    setPasswordPending(true);
    setPasswordErrorKey(null);
    setPasswordSuccessKey(null);

    if (newPassword.trim() !== confirmPassword.trim()) {
      setPasswordPending(false);
      setPasswordErrorKey("account_password_confirm_mismatch");
      return;
    }

    if (hasPassword && !currentPassword.trim()) {
      setPasswordPending(false);
      setPasswordErrorKey("account_password_current_required");
      return;
    }

    try {
      const result = await updateAccountPasswordAction({
        currentPassword,
        newPassword,
      });
      if (!result.ok) {
        setPasswordErrorKey(
          result.errorKey || "account_password_update_failed",
        );
        return;
      }
      setHasPassword(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordSuccessKey(
        result.mode === "set"
          ? "account_password_set_success"
          : "account_password_change_success",
      );
    } catch {
      setPasswordErrorKey("account_password_update_failed");
    } finally {
      setPasswordPending(false);
    }
  };

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>{t("account_credentials_title")}</CardTitle>
        <CardDescription>
          {t("account_credentials_description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <section className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Mail className="h-4 w-4" />
            <span>
              {t("account_email_current_value", {
                value: currentEmail || t("account_email_not_set"),
              })}
            </span>
          </div>
          <div className="space-y-2">
            <Label htmlFor={emailInputId}>{t("account_email_new_label")}</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id={emailInputId}
                type="email"
                value={emailInput}
                onChange={(event) => setEmailInput(event.target.value)}
                placeholder={t("account_email_new_placeholder")}
                autoComplete="email"
              />
              <Button
                type="button"
                onClick={() => void handleUpdateEmail()}
                disabled={!canSubmitEmail}
                aria-busy={emailPending}
              >
                {emailPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Mail className="mr-2 h-4 w-4" />
                )}
                {t("account_email_save_button")}
              </Button>
            </div>
          </div>
          {emailSuccessKey && (
            <Alert>
              <AlertDescription>{t(emailSuccessKey)}</AlertDescription>
            </Alert>
          )}
          {emailErrorKey && (
            <Alert variant="destructive">
              <AlertDescription>{t(emailErrorKey)}</AlertDescription>
            </Alert>
          )}
        </section>

        <section className="space-y-3 border-t pt-5">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            {accountsLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : hasPassword ? (
              <ShieldCheck className="h-4 w-4" />
            ) : (
              <ShieldOff className="h-4 w-4" />
            )}
            <span>
              {accountsLoading
                ? t("account_password_status_loading")
                : hasPassword
                  ? t("account_password_status_set")
                  : t("account_password_status_not_set")}
            </span>
          </div>

          {hasPassword && (
            <div className="space-y-2">
              <Label htmlFor={currentPasswordId}>
                {t("account_password_current_label")}
              </Label>
              <div className="relative">
                <Input
                  id={currentPasswordId}
                  type={passwordInputType}
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  placeholder={t("account_password_current_placeholder")}
                  autoComplete="current-password"
                  className={
                    !currentPasswordMissingForChange
                      ? "pr-10"
                      : "pr-10 border-destructive focus-visible:ring-destructive"
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2"
                  onClick={() => setShowPasswords((prev) => !prev)}
                  aria-label={passwordToggleLabel}
                  title={passwordToggleLabel}
                >
                  {showPasswords ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor={newPasswordId}>
              {t("account_password_new_label")}
            </Label>
            <div className="relative">
              <Input
                id={newPasswordId}
                type={passwordInputType}
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                placeholder={t("account_password_new_placeholder")}
                autoComplete="new-password"
                minLength={PASSWORD_MIN_LENGTH}
                className={newPasswordInputClass}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2"
                onClick={() => setShowPasswords((prev) => !prev)}
                aria-label={passwordToggleLabel}
                title={passwordToggleLabel}
              >
                {showPasswords ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </Button>
            </div>
            <p className={policyHintClass}>
              {t("account_password_policy_hint")}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor={confirmPasswordId}>
              {t("account_password_confirm_label")}
            </Label>
            <div className="relative">
              <Input
                id={confirmPasswordId}
                type={passwordInputType}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder={t("account_password_confirm_placeholder")}
                autoComplete="new-password"
                minLength={PASSWORD_MIN_LENGTH}
                className={confirmPasswordInputClass}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2"
                onClick={() => setShowPasswords((prev) => !prev)}
                aria-label={passwordToggleLabel}
                title={passwordToggleLabel}
              >
                {showPasswords ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </Button>
            </div>
            <p className={confirmHintClass}>
              {confirmPasswordTouched && !passwordsMatch
                ? t("account_password_confirm_mismatch")
                : t("account_password_confirm_placeholder")}
            </p>
          </div>

          <Button
            type="button"
            onClick={() => void handleUpdatePassword()}
            disabled={!canSubmitPassword}
            aria-busy={passwordPending}
          >
            {passwordPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <KeyRound className="mr-2 h-4 w-4" />
            )}
            {hasPassword
              ? t("account_password_change_button")
              : t("account_password_set_button")}
          </Button>

          {passwordSuccessKey && (
            <Alert>
              <AlertDescription>{t(passwordSuccessKey)}</AlertDescription>
            </Alert>
          )}
          {passwordErrorKey && (
            <Alert variant="destructive">
              <AlertDescription>{t(passwordErrorKey)}</AlertDescription>
            </Alert>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
