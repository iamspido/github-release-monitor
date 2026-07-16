"use client";

import { Fingerprint, KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";

import type {
  SecretRevealMethods,
  SecretRevealSocialProvider,
  SecretRevealTarget,
} from "@/components/diagnostics/secret-reveal-model";
import { GoogleBrandIcon } from "@/components/google-brand-icon";
import { GithubBrandIcon } from "@/components/icons/simple-brand-icon";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface SecretRevealDialogProps {
  target: SecretRevealTarget;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  methods: SecretRevealMethods | null;
  optionsLoading: boolean;
  totpCode: string;
  onTotpCodeChange: (value: string) => void;
  stepUpError: string;
  pendingMethod: string | null;
  isRevealing: boolean;
  confirmValue: string;
  onConfirmValueChange: (value: string) => void;
  revealError: string;
  onConfirm: () => void;
  onTotp: () => void;
  onPasskey: () => void;
  onSocial: (provider: SecretRevealSocialProvider) => void;
}

const PROVIDER_LABEL: Record<SecretRevealSocialProvider, string> = {
  github: "GitHub",
  google: "Google",
};

export function SecretRevealDialog({
  target,
  open,
  onOpenChange,
  methods,
  optionsLoading,
  totpCode,
  onTotpCodeChange,
  stepUpError,
  pendingMethod,
  isRevealing,
  confirmValue,
  onConfirmValueChange,
  revealError,
  onConfirm,
  onTotp,
  onPasskey,
  onSocial,
}: SecretRevealDialogProps) {
  const t = useTranslations("TestPage");
  const confirmInputId = React.useId();
  const totpInputId = React.useId();
  const isPending = Boolean(pendingMethod);
  const isMailPassword = target === "mail_password";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t(
              isMailPassword
                ? "mail_password_reveal_title"
                : "apprise_url_reveal_title",
            )}
          </DialogTitle>
          <DialogDescription>
            {t(
              isMailPassword
                ? "mail_password_reveal_description"
                : "apprise_url_reveal_description",
            )}
          </DialogDescription>
        </DialogHeader>

        {(methods?.password ?? true) && (
          <div className="space-y-2">
            <Label htmlFor={confirmInputId}>
              {t("mail_password_current_password_label")}
            </Label>
            <Input
              id={confirmInputId}
              type="password"
              value={confirmValue}
              onChange={(event) => onConfirmValueChange(event.target.value)}
              disabled={isRevealing}
              autoComplete="current-password"
            />
            {revealError && (
              <p className="text-sm text-destructive">{revealError}</p>
            )}
          </div>
        )}

        <div className="space-y-3 border-t pt-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <KeyRound className="size-4" />
            <span>{t("secret_reveal_alternatives_title")}</span>
          </div>
          {optionsLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              <span>{t("secret_reveal_options_loading")}</span>
            </div>
          ) : (
            <div className="space-y-3">
              {methods?.totp && (
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    id={totpInputId}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={totpCode}
                    onChange={(event) => onTotpCodeChange(event.target.value)}
                    placeholder={t("secret_reveal_totp_placeholder")}
                    disabled={isPending}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={onTotp}
                    disabled={isPending || !totpCode.trim()}
                  >
                    {pendingMethod === "totp" ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <ShieldCheck />
                    )}
                    <span>{t("secret_reveal_totp_button")}</span>
                  </Button>
                </div>
              )}
              {methods?.passkey && (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-start"
                  onClick={onPasskey}
                  disabled={isPending}
                >
                  {pendingMethod === "passkey" ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Fingerprint />
                  )}
                  <span>{t("secret_reveal_passkey_button")}</span>
                </Button>
              )}
              {methods?.socialProviders.map((provider) => (
                <Button
                  key={provider}
                  type="button"
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => onSocial(provider)}
                  disabled={isPending}
                >
                  {pendingMethod === provider ? (
                    <Loader2 className="animate-spin" />
                  ) : provider === "github" ? (
                    <GithubBrandIcon className="size-4" />
                  ) : (
                    <GoogleBrandIcon className="size-4" />
                  )}
                  <span>
                    {t("secret_reveal_social_button", {
                      provider: PROVIDER_LABEL[provider],
                    })}
                  </span>
                </Button>
              ))}
              {methods &&
                !methods.totp &&
                !methods.passkey &&
                methods.socialProviders.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    {t("secret_reveal_no_alternatives")}
                  </p>
                )}
            </div>
          )}
          {stepUpError && (
            <p className="text-sm text-destructive">{stepUpError}</p>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isRevealing}
          >
            {t("cancel")}
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={
              isRevealing || !confirmValue || methods?.password === false
            }
          >
            {isRevealing && <Loader2 className="animate-spin" />}
            {t(
              isMailPassword
                ? "mail_password_reveal_button"
                : "apprise_url_reveal_button",
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
