import { isSocialProviderConfigured } from "@/lib/auth/better-auth-config";
import {
  precheckSocialLogin as precheckSocialLoginWithProviderCheck,
  type SocialLoginPrecheckResult,
} from "@/lib/auth/repository";
import type { SocialLoginProvider } from "@/lib/auth/social-login-intent";

export {
  isAuthEmailDeliveryEnabled,
  isAuthEmailVerificationEnabled,
  isSignupEnabled,
  isSocialProviderConfigured,
} from "@/lib/auth/better-auth-config";
export { auth, ensureAuthDatabaseReady, setupAuth } from "@/lib/auth/bootstrap";
export {
  type AuthUserExistence,
  applySocialRegistrationProfile,
  canDeletePasskeyForUser,
  canUnlinkAccountForUser,
  canUnlinkSocialProviderForUser,
  ensureInitialAuthUserProfile,
  findRegistrationConflict,
  getAuthUserIdSnapshot,
  getLinkedSocialProvidersForUser,
  getSocialProviderAccountIdForUser,
  hasAnyAuthUser,
  hasCredentialPasswordAccount,
  hasPasskeyForUser,
  hasValidAuthSessionForRequest,
  hasVerifiedTotpForUser,
  type RegistrationConflictResult,
  type SocialRegistrationProfileResult,
} from "@/lib/auth/repository";

export type { SocialLoginPrecheckResult };

export function precheckSocialLogin(
  identifier: string,
  provider: SocialLoginProvider,
): SocialLoginPrecheckResult {
  return precheckSocialLoginWithProviderCheck(
    identifier,
    provider,
    isSocialProviderConfigured,
  );
}
