import { getNewPasswordFromResetRequest } from "@/lib/auth/route-request";
import { isPasswordPolicyValid } from "@/lib/password-policy";

export async function enforcePasswordResetRequestPolicy(request: Request) {
  const newPassword = await getNewPasswordFromResetRequest(request);
  if (isPasswordPolicyValid(newPassword)) {
    return null;
  }
  return new Response(JSON.stringify({ error: "invalid_password_policy" }), {
    status: 400,
    headers: { "content-type": "application/json" },
  });
}
