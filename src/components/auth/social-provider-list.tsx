"use client";

import { Loader2 } from "lucide-react";
import { GoogleSignInButton } from "@/components/google-sign-in-button";
import { GithubBrandIcon } from "@/components/icons/simple-brand-icon";
import { Button } from "@/components/ui/button";
import type { AuthSocialProvider } from "@/lib/auth/client-flow-utils";

type SocialProviderListProps = {
  providers: AuthSocialProvider[];
  pendingProvider: AuthSocialProvider | null;
  disabled: (provider: AuthSocialProvider) => boolean;
  getLabel: (provider: AuthSocialProvider) => string;
  onSelect: (provider: AuthSocialProvider) => void;
};

export function SocialProviderList({
  providers,
  pendingProvider,
  disabled,
  getLabel,
  onSelect,
}: SocialProviderListProps) {
  return (
    <>
      {providers.map((provider) => {
        const isPending = pendingProvider === provider;
        const isDisabled = disabled(provider);
        const buttonLabel = getLabel(provider);

        if (provider === "google") {
          return (
            <GoogleSignInButton
              key={provider}
              label={buttonLabel}
              disabled={isDisabled}
              pending={isPending}
              onClick={() => onSelect(provider)}
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
            onClick={() => onSelect(provider)}
            aria-busy={isPending}
          >
            {isPending ? (
              <Loader2 className="me-2 h-4 w-4 animate-spin" />
            ) : (
              <GithubBrandIcon className="me-2 h-4 w-4" />
            )}
            {buttonLabel}
          </Button>
        );
      })}
    </>
  );
}
