"use client";

import { Loader2 } from "lucide-react";
import { GoogleBrandIcon } from "@/components/google-brand-icon";
import { cn } from "@/lib/utils";

interface GoogleSignInButtonProps {
  label: string;
  disabled?: boolean;
  pending?: boolean;
  onClick: () => void;
}

export function GoogleSignInButton({
  label,
  disabled = false,
  pending = false,
  onClick,
}: GoogleSignInButtonProps) {
  return (
    <button
      type="button"
      className={cn("gsi-material-button gsi-material-button-dark", "w-full")}
      onClick={onClick}
      disabled={disabled}
      aria-busy={pending}
    >
      <div className="gsi-material-button-state" />
      <div className="gsi-material-button-content-wrapper">
        <div className="gsi-material-button-icon">
          {pending ? (
            <Loader2 className="h-5 w-5 animate-spin text-[#5f6368]" />
          ) : (
            <GoogleBrandIcon className="h-5 w-5" />
          )}
        </div>
        <span className="gsi-material-button-contents">{label}</span>
        <span className="sr-only">{label}</span>
      </div>
    </button>
  );
}
