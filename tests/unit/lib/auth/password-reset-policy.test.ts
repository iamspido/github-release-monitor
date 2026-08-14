import { enforcePasswordResetRequestPolicy } from "@/lib/auth/password-reset-policy";

function requestWithPassword(newPassword: unknown) {
  return new Request("http://localhost/api/auth/reset-password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ newPassword, token: "one-time-token" }),
  });
}

describe("password reset API policy", () => {
  it.each(["short", "alllowercase123", "ALLUPPERCASE123", "NoNumbersHere"])(
    "rejects a direct request using weak password %s",
    async (password) => {
      const response = await enforcePasswordResetRequestPolicy(
        requestWithPassword(password),
      );

      expect(response?.status).toBe(400);
      await expect(response?.json()).resolves.toEqual({
        error: "invalid_password_policy",
      });
    },
  );

  it("allows a direct request that meets the application password policy", async () => {
    await expect(
      enforcePasswordResetRequestPolicy(requestWithPassword("StrongPassword1")),
    ).resolves.toBeNull();
  });

  it("rejects a direct request above Better Auth's password length limit", async () => {
    const password = `Aa1${"x".repeat(126)}`;
    const response = await enforcePasswordResetRequestPolicy(
      requestWithPassword(password),
    );

    expect(password).toHaveLength(129);
    expect(response?.status).toBe(400);
    await expect(response?.json()).resolves.toEqual({
      error: "invalid_password_policy",
    });
  });
});
