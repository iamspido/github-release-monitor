import { auth, ensureAuthDatabaseReady } from "@/lib/auth";

export async function getAuthenticatedUserId(
  requestHeaders: Headers,
): Promise<string | null> {
  try {
    await ensureAuthDatabaseReady();
    const session = await auth.api.getSession({ headers: requestHeaders });
    return typeof session?.user?.id === "string"
      ? session.user.id.trim() || null
      : null;
  } catch {
    return null;
  }
}
