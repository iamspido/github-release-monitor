import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import Database from "better-sqlite3";

describe("Better Auth password reset integration", () => {
  it("uses the token once, changes the password, and revokes existing sessions", async () => {
    const database = new Database(":memory:");
    let resetToken = "";
    let resetUrl = "";
    const config = {
      database,
      secret: "integration-test-secret-that-is-long-and-random-enough-123456",
      baseURL: "http://localhost:3000",
      emailAndPassword: {
        enabled: true,
        autoSignIn: false,
        minPasswordLength: 12,
        resetPasswordTokenExpiresIn: 900,
        revokeSessionsOnPasswordReset: true,
        sendResetPassword: async (payload: { token: string; url: string }) => {
          resetToken = payload.token;
          resetUrl = payload.url;
        },
      },
    };

    try {
      const migrations = await getMigrations(config);
      await migrations.runMigrations();
      const auth = betterAuth(config);
      const signUpResponse = await auth.api.signUpEmail({
        body: {
          name: "Integration User",
          email: "integration@example.test",
          password: "InitialPassword1",
        },
        asResponse: true,
      });
      const signUpPayload = (await signUpResponse.json()) as {
        user?: { id?: unknown } | null;
      };
      expect(typeof signUpPayload.user?.id).toBe("string");
      const sessionCountAfterSignUp = database
        .prepare("SELECT count(*) AS count FROM session")
        .get() as { count: number };
      expect(sessionCountAfterSignUp.count).toBe(0);
      const signInResponse = await auth.api.signInEmail({
        body: {
          email: "integration@example.test",
          password: "InitialPassword1",
        },
        asResponse: true,
      });
      const sessionCookie = signInResponse.headers.get("set-cookie") || "";
      expect(sessionCookie).not.toBe("");

      await auth.api.requestPasswordReset({
        body: {
          email: "integration@example.test",
          redirectTo: "http://localhost:3000/en/reset-password",
        },
      });
      expect(resetToken).not.toBe("");
      const callbackResponse = await auth.handler(new Request(resetUrl));
      expect(callbackResponse.status).toBeGreaterThanOrEqual(300);
      expect(callbackResponse.status).toBeLessThan(400);
      const callbackLocation = new URL(
        callbackResponse.headers.get("location") || "",
      );
      expect(callbackLocation.pathname).toBe("/en/reset-password");
      expect(callbackLocation.searchParams.get("token")).toBe(resetToken);

      await auth.api.resetPassword({
        body: { token: resetToken, newPassword: "ReplacementPassword1" },
      });
      await expect(
        auth.api.resetPassword({
          body: { token: resetToken, newPassword: "AnotherPassword1" },
        }),
      ).rejects.toThrow();

      const revokedSession = await auth.api.getSession({
        headers: new Headers({ cookie: sessionCookie }),
      });
      expect(revokedSession).toBeNull();
      await expect(
        auth.api.signInEmail({
          body: {
            email: "integration@example.test",
            password: "InitialPassword1",
          },
        }),
      ).rejects.toThrow();
      await expect(
        auth.api.signInEmail({
          body: {
            email: "integration@example.test",
            password: "ReplacementPassword1",
          },
        }),
      ).resolves.toBeTruthy();

      resetToken = "";
      resetUrl = "";
      await auth.api.requestPasswordReset({
        body: {
          email: "integration@example.test",
          redirectTo: "http://localhost:3000/en/reset-password",
        },
      });
      expect(resetUrl).not.toBe("");
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(Date.now() + 901_000);
      const expiredCallbackResponse = await auth.handler(new Request(resetUrl));
      expect(expiredCallbackResponse.status).toBeGreaterThanOrEqual(300);
      expect(expiredCallbackResponse.status).toBeLessThan(400);
      const expiredLocation = new URL(
        expiredCallbackResponse.headers.get("location") || "",
      );
      expect(expiredLocation.pathname).toBe("/en/reset-password");
      expect(expiredLocation.searchParams.get("error")).toBe("INVALID_TOKEN");
    } finally {
      vi.useRealTimers();
      database.close();
    }
  });
});
