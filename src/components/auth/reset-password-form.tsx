"use client";

import { ArrowLeft, KeyRound, Loader2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import * as React from "react";
import { PasswordVisibilityButton } from "@/components/auth/password-visibility-button";
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
  isPasswordPolicyValid,
  keepPasswordInputWhitespaceFree,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "@/lib/password-policy";

export function ResetPasswordForm({ loginPath }: { loginPath: string }) {
  const t = useTranslations("ResetPasswordPage");
  const searchParams = useSearchParams();
  const token = searchParams.get("token")?.trim() || "";
  const tokenError = searchParams.get("error")?.trim() || "";
  const [newPassword, setNewPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [visible, setVisible] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [success, setSuccess] = React.useState(false);
  const [errorKey, setErrorKey] = React.useState<string | null>(null);
  const passwordId = React.useId();
  const confirmId = React.useId();
  const tokenInvalid = !token || Boolean(tokenError);
  const passwordValid = isPasswordPolicyValid(newPassword);
  const passwordsMatch =
    newPassword.length > 0 && newPassword === confirmPassword;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending || tokenInvalid || !passwordValid || !passwordsMatch) return;
    setPending(true);
    setErrorKey(null);
    try {
      const result = await authClient.resetPassword({ newPassword, token });
      if (result.error) {
        const errorCode = result.error.code?.trim().toUpperCase();
        setErrorKey(
          errorCode === "INVALID_TOKEN" || errorCode === "TOKEN_EXPIRED"
            ? "invalid_or_expired"
            : "reset_failed",
        );
        return;
      }
      setSuccess(true);
      setNewPassword("");
      setConfirmPassword("");
    } catch {
      setErrorKey("reset_failed");
    } finally {
      setPending(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {success ? (
          <Alert>
            <KeyRound className="h-4 w-4" />
            <AlertDescription>{t("success")}</AlertDescription>
          </Alert>
        ) : tokenInvalid ? (
          <Alert variant="destructive">
            <AlertDescription>{t("invalid_or_expired")}</AlertDescription>
          </Alert>
        ) : (
          <form
            id="reset-password-form"
            onSubmit={handleSubmit}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor={passwordId}>{t("password_label")}</Label>
              <div className="relative">
                <Input
                  id={passwordId}
                  dir="ltr"
                  type={visible ? "text" : "password"}
                  value={newPassword}
                  onChange={(event) =>
                    setNewPassword((current) =>
                      keepPasswordInputWhitespaceFree(
                        current,
                        event.target.value,
                      ),
                    )
                  }
                  autoComplete="new-password"
                  minLength={PASSWORD_MIN_LENGTH}
                  maxLength={PASSWORD_MAX_LENGTH}
                  className="pe-10"
                  required
                  autoFocus
                />
                <PasswordVisibilityButton
                  visible={visible}
                  showLabel={t("show_password")}
                  hideLabel={t("hide_password")}
                  onToggle={() => setVisible((current) => !current)}
                />
              </div>
              <p
                className={
                  passwordValid
                    ? "text-xs text-emerald-600"
                    : "text-xs text-muted-foreground"
                }
              >
                {t("password_requirements")}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor={confirmId}>{t("confirm_label")}</Label>
              <div className="relative">
                <Input
                  id={confirmId}
                  dir="ltr"
                  type={visible ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(event) =>
                    setConfirmPassword((current) =>
                      keepPasswordInputWhitespaceFree(
                        current,
                        event.target.value,
                      ),
                    )
                  }
                  autoComplete="new-password"
                  minLength={PASSWORD_MIN_LENGTH}
                  maxLength={PASSWORD_MAX_LENGTH}
                  className="pe-10"
                  required
                />
                <PasswordVisibilityButton
                  visible={visible}
                  showLabel={t("show_password")}
                  hideLabel={t("hide_password")}
                  onToggle={() => setVisible((current) => !current)}
                />
              </div>
              {confirmPassword.length > 0 && !passwordsMatch && (
                <p className="text-xs text-destructive">
                  {t("password_mismatch")}
                </p>
              )}
            </div>
          </form>
        )}
        {errorKey && (
          <Alert variant="destructive">
            <AlertDescription>{t(errorKey)}</AlertDescription>
          </Alert>
        )}
      </CardContent>
      <CardFooter className="flex-col gap-2">
        {!success && !tokenInvalid && (
          <Button
            type="submit"
            form="reset-password-form"
            className="w-full"
            disabled={pending || !passwordValid || !passwordsMatch}
          >
            {pending ? (
              <Loader2 className="me-2 h-4 w-4 animate-spin" />
            ) : (
              <KeyRound className="me-2 h-4 w-4" />
            )}
            {t("submit")}
          </Button>
        )}
        <Button type="button" variant="outline" className="w-full" asChild>
          <Link href={loginPath}>
            <ArrowLeft className="me-2 h-4 w-4 rtl:scale-x-[-1]" />
            {t("back_to_login")}
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
