export const authenticationMethods = [
  "Basic",
  "AllowUnauthenticated",
  "External",
] as const;

export type AuthenticationMethod = (typeof authenticationMethods)[number];

const authenticationMethodSet = new Set<string>(authenticationMethods);

export type AuthAccess = {
  authenticationMethod: AuthenticationMethod;
  isAuthenticated: boolean;
  canMutate: boolean;
  canAccessRestrictedPages: boolean;
  showLogin: boolean;
  showLogout: boolean;
  showSettings: boolean;
  showTest: boolean;
};

export function getAuthenticationMethod(
  env: Partial<NodeJS.ProcessEnv> = process.env,
): AuthenticationMethod {
  const raw = env.AUTHENTICATION_METHOD?.trim();
  if (raw && authenticationMethodSet.has(raw)) {
    return raw as AuthenticationMethod;
  }

  return "Basic";
}

export function buildAuthAccess(
  authenticationMethod: AuthenticationMethod,
  isAuthenticated: boolean,
): AuthAccess {
  const externalAuth = authenticationMethod === "External";
  const canMutate = externalAuth || isAuthenticated;
  const canAccessRestrictedPages = externalAuth || isAuthenticated;

  return {
    authenticationMethod,
    isAuthenticated,
    canMutate,
    canAccessRestrictedPages,
    showLogin: authenticationMethod !== "External" && !isAuthenticated,
    showLogout: authenticationMethod !== "External" && isAuthenticated,
    showSettings: canAccessRestrictedPages,
    showTest: canAccessRestrictedPages,
  };
}

export function canReadHomeUnauthenticated(
  authenticationMethod: AuthenticationMethod,
): boolean {
  return authenticationMethod !== "Basic";
}
