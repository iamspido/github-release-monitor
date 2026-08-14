"use client";

import { ArrowLeft, Loader2, Mail } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import * as React from "react";
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

export function ForgotPasswordForm({
  emailEnabled,
  loginPath,
  resetPath,
}: {
  emailEnabled: boolean;
  loginPath: string;
  resetPath: string;
}) {
  const t = useTranslations("ForgotPasswordPage");
  const [pending, setPending] = React.useState(false);
  const [submitted, setSubmitted] = React.useState(false);
  const [networkError, setNetworkError] = React.useState(false);
  const identifierId = React.useId();

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending || !emailEnabled) return;
    setPending(true);
    setNetworkError(false);
    const formData = new FormData(event.currentTarget);
    const identifier = String(formData.get("identifier") || "")
      .trim()
      .toLowerCase();
    try {
      const result = await authClient.requestPasswordReset({
        email: identifier,
        redirectTo: resetPath,
      });
      if (result.error) {
        setNetworkError(true);
        return;
      }
      setSubmitted(true);
    } catch {
      setNetworkError(true);
    } finally {
      setPending(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>
          {emailEnabled ? t("description") : t("cli_description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {emailEnabled ? (
          submitted ? (
            <Alert>
              <Mail className="h-4 w-4" />
              <AlertDescription>{t("success")}</AlertDescription>
            </Alert>
          ) : (
            <form id="forgot-password-form" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <Label htmlFor={identifierId}>{t("identifier_label")}</Label>
                <Input
                  id={identifierId}
                  name="identifier"
                  type="text"
                  dir="ltr"
                  autoComplete="username"
                  maxLength={320}
                  placeholder={t("identifier_placeholder")}
                  required
                  autoFocus
                />
              </div>
            </form>
          )
        ) : (
          <Alert>
            <AlertDescription>
              <p>{t("cli_notice")}</p>
              <code
                className="mt-3 block overflow-x-auto rounded bg-muted p-3 text-xs"
                dir="ltr"
              >
                docker exec -it github-release-monitor node /app/grm-cli.mjs
                auth reset-password --user &lt;username-or-email&gt;
              </code>
            </AlertDescription>
          </Alert>
        )}
        {networkError && (
          <Alert variant="destructive">
            <AlertDescription>{t("network_error")}</AlertDescription>
          </Alert>
        )}
      </CardContent>
      <CardFooter className="flex-col gap-2">
        {emailEnabled && !submitted && (
          <Button
            type="submit"
            form="forgot-password-form"
            className="w-full"
            disabled={pending}
          >
            {pending ? (
              <Loader2 className="me-2 h-4 w-4 animate-spin" />
            ) : (
              <Mail className="me-2 h-4 w-4" />
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
