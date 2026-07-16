import { ensureAuthDatabaseReady, hasAnyAuthUser } from "@/lib/auth";
import { isAuthSetupTokenConfigured } from "@/lib/auth/config";
import { isAuthSetupLocked } from "@/lib/auth/setup-lock";

export type AuthSetupAvailability =
  | "available"
  | "token_invalid"
  | "locked"
  | "state_unknown"
  | "user_exists";

export async function getAuthSetupAvailability(): Promise<AuthSetupAvailability> {
  await ensureAuthDatabaseReady();
  if (!isAuthSetupTokenConfigured()) return "token_invalid";
  if (await isAuthSetupLocked()) return "locked";

  const userState = hasAnyAuthUser();
  if (userState === "unknown") return "state_unknown";
  if (userState === "has_user") return "user_exists";
  return "available";
}
