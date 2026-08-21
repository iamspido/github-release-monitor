export function getAuthActionFromPathname(pathname: string) {
  const prefix = "/api/auth/";
  if (!pathname.startsWith(prefix)) return pathname;
  return pathname.slice(prefix.length) || "(root)";
}

export function getSafeAuthActionForLog(action: string) {
  return action.startsWith("reset-password/")
    ? "reset-password/[redacted]"
    : action;
}

export function isPasswordResetTokenBearingAction(action: string) {
  return action === "reset-password" || action.startsWith("reset-password/");
}

export function getOAuthProviderFromAction(action: string) {
  if (!action.startsWith("callback/")) return null;
  return action.split("/")[1] || null;
}

export function isSocialAuthAction(action: string) {
  return action === "sign-in/social" || action.startsWith("callback/");
}

export function isSocialSignInAction(action: string) {
  return action === "sign-in/social";
}

export async function getSocialProviderFromSignInRequest(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  const bodyText = await request.clone().text();
  if (!bodyText) return null;

  if (contentType.includes("application/json")) {
    try {
      const data = JSON.parse(bodyText) as { provider?: unknown };
      const provider =
        typeof data.provider === "string"
          ? data.provider.trim().toLowerCase()
          : "";
      return provider || null;
    } catch {
      return null;
    }
  }

  if (contentType.includes("application/x-www-form-urlencoded")) {
    const provider = new URLSearchParams(bodyText)
      .get("provider")
      ?.trim()
      .toLowerCase();
    return provider || null;
  }

  return null;
}

export async function getAccountSelectionFromUnlinkRequest(
  request: Request,
): Promise<{ accountId: string } | null> {
  try {
    const data = (await request.clone().json()) as {
      accountId?: unknown;
    };
    if (typeof data.accountId !== "string" || !data.accountId.trim()) {
      return null;
    }
    return { accountId: data.accountId.trim() };
  } catch {
    return null;
  }
}

export async function getPasskeyIdFromDeleteRequest(request: Request) {
  try {
    const data = (await request.clone().json()) as { id?: unknown };
    return typeof data.id === "string" ? data.id.trim() : "";
  } catch {
    return "";
  }
}

export async function getNewPasswordFromResetRequest(request: Request) {
  try {
    const data = (await request.clone().json()) as { newPassword?: unknown };
    return typeof data.newPassword === "string" ? data.newPassword : "";
  } catch {
    return "";
  }
}

export function getOAuthErrorFromResponseLocation(response: Response) {
  const location = response.headers.get("location");
  if (!location) return null;

  try {
    const parsed = new URL(location, "http://localhost");
    return parsed.searchParams.get("error") || parsed.searchParams.get("code");
  } catch {
    return null;
  }
}
