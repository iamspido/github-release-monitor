"use client";

import * as React from "react";
import { PasswordVisibilityButton } from "@/components/auth/password-visibility-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  isPasswordPolicyValid,
  keepPasswordInputWhitespaceFree,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "@/lib/password-policy";

interface NewPasswordFieldProps {
  id: string;
  label: string;
  placeholder: string;
  requirements: string;
  showLabel: string;
  hideLabel: string;
}

export function NewPasswordField({
  id,
  label,
  placeholder,
  requirements,
  showLabel,
  hideLabel,
}: NewPasswordFieldProps) {
  const [password, setPassword] = React.useState("");
  const [visible, setVisible] = React.useState(false);
  const passwordTouched = password.length > 0;
  const passwordPolicyMet = isPasswordPolicyValid(password);
  const validationClass = passwordTouched
    ? passwordPolicyMet
      ? "border-emerald-500 focus-visible:ring-emerald-500"
      : "border-destructive focus-visible:ring-destructive"
    : "";
  const hintClass = passwordTouched
    ? passwordPolicyMet
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-destructive"
    : "text-muted-foreground";

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          name="password"
          dir="ltr"
          type={visible ? "text" : "password"}
          value={password}
          onChange={(event) =>
            setPassword((currentValue) =>
              keepPasswordInputWhitespaceFree(currentValue, event.target.value),
            )
          }
          placeholder={placeholder}
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          maxLength={PASSWORD_MAX_LENGTH}
          className={["pe-10", validationClass].filter(Boolean).join(" ")}
          required
        />
        <PasswordVisibilityButton
          visible={visible}
          showLabel={showLabel}
          hideLabel={hideLabel}
          onToggle={() => setVisible((current) => !current)}
        />
      </div>
      <p className={["text-xs", hintClass].join(" ")} aria-live="polite">
        {requirements}
      </p>
    </div>
  );
}
