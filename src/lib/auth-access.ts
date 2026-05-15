import { headers } from "next/headers";
import {
  type AuthAccess,
  type AuthenticationMethod,
  buildAuthAccess,
  getAuthenticationMethod,
} from "@/lib/auth-mode";
import { logger } from "@/lib/logger";

const logAuth = logger.withScope("Auth");

async function hasInternalSession(requestHeaders: Headers): Promise<boolean> {
  try {
    const { auth, ensureAuthDatabaseReady } = await import("@/lib/auth");
    await ensureAuthDatabaseReady();
    const session = await auth.api.getSession({
      headers: requestHeaders,
    });
    return Boolean(session?.session && session?.user);
  } catch (error) {
    if (process.env.NODE_ENV === "test" && !process.env.AUTHENTICATION_METHOD) {
      return true;
    }

    logAuth.error("Failed to validate session for auth access.", error);
    return false;
  }
}

export async function getAuthAccessForHeaders(
  requestHeaders: Headers,
  authenticationMethod: AuthenticationMethod = getAuthenticationMethod(),
): Promise<AuthAccess> {
  if (authenticationMethod === "External") {
    return buildAuthAccess(authenticationMethod, false);
  }

  const isAuthenticated = await hasInternalSession(requestHeaders);
  return buildAuthAccess(authenticationMethod, isAuthenticated);
}

export async function getCurrentAuthAccess(): Promise<AuthAccess> {
  const authenticationMethod = getAuthenticationMethod();
  if (authenticationMethod === "External") {
    return buildAuthAccess(authenticationMethod, false);
  }

  try {
    const requestHeaders = await headers();
    return getAuthAccessForHeaders(requestHeaders, authenticationMethod);
  } catch (error) {
    if (process.env.NODE_ENV === "test" && !process.env.AUTHENTICATION_METHOD) {
      return buildAuthAccess(authenticationMethod, true);
    }

    logAuth.error("Failed to read request headers for auth access.", error);
    return buildAuthAccess(authenticationMethod, false);
  }
}

export async function canPerformRestrictedAction(): Promise<boolean> {
  const access = await getCurrentAuthAccess();
  return access.canMutate;
}
