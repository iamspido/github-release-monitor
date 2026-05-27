"use client";

import {
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  ShieldCheck,
  ShieldOff,
} from "lucide-react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import * as React from "react";
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
import { authClient } from "@/lib/auth/client";

type TwoFactorEnableData = {
  totpURI: string | null;
  backupCodes: string[];
};

function normalizeEnableResponse(payload: unknown): TwoFactorEnableData {
  const data = (payload as { data?: unknown } | null)?.data;
  const source =
    data && typeof data === "object"
      ? (data as Record<string, unknown>)
      : payload && typeof payload === "object"
        ? (payload as Record<string, unknown>)
        : {};

  const rawTotp =
    source.totpURI ??
    source.totpUri ??
    source.totp_url ??
    source.uri ??
    source.otpauthURL;
  const totpURI =
    typeof rawTotp === "string" && rawTotp.trim() ? rawTotp.trim() : null;

  const rawCodes = source.backupCodes;
  const backupCodes = Array.isArray(rawCodes)
    ? rawCodes
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter(Boolean)
    : [];

  return { totpURI, backupCodes };
}

export function TwoFactorSettingsCard() {
  const t = useTranslations("SettingsPage");
  const sessionState = authClient.useSession();
  const sessionData = (sessionState as { data?: unknown }).data as
    | { user?: { twoFactorEnabled?: unknown } }
    | undefined;
  const sessionLoading = Boolean(
    (sessionState as { isPending?: unknown }).isPending,
  );

  const [enabledOverride, setEnabledOverride] = React.useState<boolean | null>(
    null,
  );
  const [enablePassword, setEnablePassword] = React.useState("");
  const [disablePassword, setDisablePassword] = React.useState("");
  const [verifyCode, setVerifyCode] = React.useState("");
  const [pendingTotpUri, setPendingTotpUri] = React.useState<string | null>(
    null,
  );
  const [qrCodeDataUrl, setQrCodeDataUrl] = React.useState<string | null>(null);
  const [qrLoading, setQrLoading] = React.useState(false);
  const [qrUnavailable, setQrUnavailable] = React.useState(false);
  const [backupCodes, setBackupCodes] = React.useState<string[]>([]);
  const [errorKey, setErrorKey] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [enabling, setEnabling] = React.useState(false);
  const [verifying, setVerifying] = React.useState(false);
  const [disabling, setDisabling] = React.useState(false);
  const [showPasswords, setShowPasswords] = React.useState(false);
  const enablePasswordId = React.useId();
  const verifyCodeId = React.useId();
  const disablePasswordId = React.useId();

  const sessionEnabled = Boolean(sessionData?.user?.twoFactorEnabled);
  const twoFactorEnabled =
    enabledOverride === null ? sessionEnabled : enabledOverride;
  const inSetupFlow = Boolean(pendingTotpUri);
  const passwordInputType = showPasswords ? "text" : "password";
  const passwordToggleLabel = showPasswords
    ? t("hide_password")
    : t("show_password");

  React.useEffect(() => {
    let active = true;

    if (!pendingTotpUri) {
      setQrCodeDataUrl(null);
      setQrLoading(false);
      setQrUnavailable(false);
      return () => {
        active = false;
      };
    }

    setQrLoading(true);
    setQrUnavailable(false);
    setQrCodeDataUrl(null);

    (async () => {
      try {
        const QRCodeModule = await import("qrcode");
        const url = await QRCodeModule.toDataURL(pendingTotpUri, {
          errorCorrectionLevel: "M",
          margin: 1,
          width: 224,
        });
        if (!active) return;
        setQrCodeDataUrl(url);
      } catch {
        if (!active) return;
        setQrUnavailable(true);
      } finally {
        if (active) {
          setQrLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [pendingTotpUri]);

  const handleEnable = async () => {
    if (enabling || verifying || disabling) return;
    setEnabling(true);
    setErrorKey(null);
    setCopied(false);
    try {
      const result = await authClient.twoFactor.enable({
        password: enablePassword,
      });
      if (result.error) {
        setErrorKey("two_factor_error_enable");
        return;
      }

      const normalized = normalizeEnableResponse(result);
      if (!normalized.totpURI) {
        setErrorKey("two_factor_error_enable");
        return;
      }

      setPendingTotpUri(normalized.totpURI);
      setBackupCodes(normalized.backupCodes);
    } catch {
      setErrorKey("two_factor_error_enable");
    } finally {
      setEnabling(false);
    }
  };

  const handleVerify = async () => {
    if (!pendingTotpUri || verifying || enabling || disabling) return;
    setVerifying(true);
    setErrorKey(null);
    try {
      const result = await authClient.twoFactor.verifyTotp({
        code: verifyCode.trim(),
        trustDevice: true,
      });
      if (result.error) {
        setErrorKey("two_factor_error_verify");
        return;
      }
      setEnabledOverride(true);
      setPendingTotpUri(null);
      setBackupCodes([]);
      setVerifyCode("");
      setEnablePassword("");
      setDisablePassword("");
    } catch {
      setErrorKey("two_factor_error_verify");
    } finally {
      setVerifying(false);
    }
  };

  const handleDisable = async () => {
    if (disabling || enabling || verifying) return;
    setDisabling(true);
    setErrorKey(null);
    try {
      const result = await authClient.twoFactor.disable({
        password: disablePassword,
      });
      if (result.error) {
        setErrorKey("two_factor_error_disable");
        return;
      }
      setEnabledOverride(false);
      setPendingTotpUri(null);
      setBackupCodes([]);
      setVerifyCode("");
      setEnablePassword("");
      setDisablePassword("");
    } catch {
      setErrorKey("two_factor_error_disable");
    } finally {
      setDisabling(false);
    }
  };

  const handleCopyOtpUri = async () => {
    if (!pendingTotpUri) return;
    try {
      await navigator.clipboard.writeText(pendingTotpUri);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>{t("two_factor_title")}</CardTitle>
        <CardDescription>{t("two_factor_description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {sessionLoading ? (
          <p className="text-sm text-muted-foreground">
            {t("two_factor_loading")}
          </p>
        ) : twoFactorEnabled ? (
          <Alert>
            <ShieldCheck className="h-4 w-4" />
            <AlertDescription>{t("two_factor_enabled")}</AlertDescription>
          </Alert>
        ) : (
          <Alert>
            <ShieldOff className="h-4 w-4" />
            <AlertDescription>{t("two_factor_disabled")}</AlertDescription>
          </Alert>
        )}

        {!twoFactorEnabled && (
          <div className="space-y-2">
            <Label htmlFor={enablePasswordId}>
              {t("two_factor_enable_password_label")}
            </Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative grow">
                <Input
                  id={enablePasswordId}
                  type={passwordInputType}
                  value={enablePassword}
                  onChange={(event) => setEnablePassword(event.target.value)}
                  placeholder={t("two_factor_enable_password_placeholder")}
                  autoComplete="current-password"
                  className="pr-10"
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
              <Button
                type="button"
                onClick={() => void handleEnable()}
                disabled={
                  enabling ||
                  verifying ||
                  disabling ||
                  !enablePassword.trim() ||
                  inSetupFlow
                }
                aria-busy={enabling}
              >
                {enabling ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <ShieldCheck className="mr-2 h-4 w-4" />
                )}
                {t("two_factor_enable_button")}
              </Button>
            </div>
          </div>
        )}

        {!twoFactorEnabled && inSetupFlow && (
          <div className="space-y-3 rounded-md border p-3">
            <p className="text-sm text-muted-foreground">
              {t("two_factor_setup_instruction")}
            </p>
            <div className="space-y-2">
              <Label>{t("two_factor_setup_qr_label")}</Label>
              <div className="flex min-h-64 items-center justify-center rounded-md border bg-background p-3">
                {qrCodeDataUrl ? (
                  <Image
                    src={qrCodeDataUrl}
                    alt={t("two_factor_setup_qr_alt")}
                    className="h-56 w-56 rounded-sm"
                    width={224}
                    height={224}
                    unoptimized
                  />
                ) : qrLoading ? (
                  <p className="text-sm text-muted-foreground">
                    {t("two_factor_setup_qr_loading")}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t("two_factor_setup_qr_fallback")}
                  </p>
                )}
              </div>
              {qrUnavailable && (
                <p className="text-xs text-muted-foreground">
                  {t("two_factor_setup_qr_fallback")}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>{t("two_factor_setup_uri_label")}</Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  value={pendingTotpUri ?? ""}
                  readOnly
                  className="font-mono text-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void handleCopyOtpUri()}
                >
                  <Copy className="mr-2 h-4 w-4" />
                  {copied
                    ? t("two_factor_uri_copied")
                    : t("two_factor_copy_uri_button")}
                </Button>
              </div>
            </div>
            {backupCodes.length > 0 && (
              <div className="space-y-2">
                <Label>{t("two_factor_backup_codes_label")}</Label>
                <div className="grid grid-cols-1 gap-1 rounded-md border p-2 font-mono text-xs sm:grid-cols-2">
                  {backupCodes.map((code) => (
                    <span key={code}>{code}</span>
                  ))}
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor={verifyCodeId}>
                {t("two_factor_verify_code_label")}
              </Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  id={verifyCodeId}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={8}
                  value={verifyCode}
                  onChange={(event) => setVerifyCode(event.target.value)}
                  placeholder={t("two_factor_verify_code_placeholder")}
                />
                <Button
                  type="button"
                  onClick={() => void handleVerify()}
                  disabled={
                    verifying || enabling || disabling || !verifyCode.trim()
                  }
                  aria-busy={verifying}
                >
                  {verifying ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <KeyRound className="mr-2 h-4 w-4" />
                  )}
                  {t("two_factor_verify_button")}
                </Button>
              </div>
            </div>
          </div>
        )}

        {twoFactorEnabled && (
          <div className="space-y-2">
            <Label htmlFor={disablePasswordId}>
              {t("two_factor_disable_password_label")}
            </Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative grow">
                <Input
                  id={disablePasswordId}
                  type={passwordInputType}
                  value={disablePassword}
                  onChange={(event) => setDisablePassword(event.target.value)}
                  placeholder={t("two_factor_disable_password_placeholder")}
                  autoComplete="current-password"
                  className="pr-10"
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
              <Button
                type="button"
                variant="destructive"
                onClick={() => void handleDisable()}
                disabled={
                  disabling || enabling || verifying || !disablePassword
                }
                aria-busy={disabling}
              >
                {disabling ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <ShieldOff className="mr-2 h-4 w-4" />
                )}
                {t("two_factor_disable_button")}
              </Button>
            </div>
          </div>
        )}

        {errorKey && (
          <Alert variant="destructive">
            <AlertDescription>{t(errorKey)}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
