"use client";

import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";

type PasswordVisibilityButtonProps = {
  visible: boolean;
  showLabel: string;
  hideLabel: string;
  onToggle: () => void;
};

export function PasswordVisibilityButton({
  visible,
  showLabel,
  hideLabel,
  onToggle,
}: PasswordVisibilityButtonProps) {
  const label = visible ? hideLabel : showLabel;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2"
      onClick={onToggle}
      aria-label={label}
      title={label}
    >
      {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
    </Button>
  );
}
