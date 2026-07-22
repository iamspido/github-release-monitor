import {
  isSocialErrorKey,
  isValidSocialUsername,
  mapOauthErrorToMessageKey,
  mapRegisterSocialPrecheckErrorToMessageKey,
  mapSetupApiErrorToMessageKey,
  normalizeApiErrorCode,
  normalizeLocalizedRedirectPath,
  normalizeOptionalSafeRelativePath,
  normalizeSafeRelativePath,
  readApiErrorCode,
} from "@/lib/auth/client-flow-utils";

describe("auth/client-flow-utils", () => {
  it("maps OAuth callback errors to translation keys", () => {
    expect(mapOauthErrorToMessageKey(null)).toBeNull();
    expect(mapOauthErrorToMessageKey(" signup_disabled ")).toBe(
      "error_social_signup_disabled",
    );
    expect(mapOauthErrorToMessageKey("STATE_MISMATCH")).toBe(
      "error_social_state_mismatch",
    );
    expect(mapOauthErrorToMessageKey("unknown_code")).toBe(
      "error_social_login_failed",
    );
  });

  it("recognizes social error translation keys", () => {
    expect(isSocialErrorKey("error_social_login_failed")).toBe(true);
    expect(isSocialErrorKey("error_invalid_credentials")).toBe(false);
    expect(isSocialErrorKey(null)).toBe(false);
  });

  it("validates usernames with the shared Better Auth username policy", () => {
    expect(isValidSocialUsername(" admin_user.1 ")).toBe(true);
    expect(isValidSocialUsername("ad")).toBe(false);
    expect(isValidSocialUsername("admin-user")).toBe(false);
  });

  it("normalizes safe relative paths", () => {
    expect(normalizeSafeRelativePath("/settings")).toBe("/settings");
    expect(normalizeSafeRelativePath("https://evil.test")).toBe("/");
    expect(normalizeSafeRelativePath("//evil.test")).toBe("/");
    expect(normalizeSafeRelativePath("/../settings")).toBe("/");
    expect(normalizeSafeRelativePath("/\\\\evil.test")).toBe("/");
    expect(normalizeSafeRelativePath("/%2e%2e/settings")).toBe("/");
    expect(normalizeSafeRelativePath("/%2f%2fevil.test")).toBe("/");
    expect(normalizeSafeRelativePath("/settings?q=1#section")).toBe(
      "/settings?q=1#section",
    );
    expect(normalizeOptionalSafeRelativePath("/settings")).toBe("/settings");
    expect(normalizeOptionalSafeRelativePath("https://evil.test")).toBe(
      undefined,
    );
  });

  it("normalizes localized redirects only for full locale path segments", () => {
    expect(normalizeLocalizedRedirectPath("/en/settings", "en")).toBe(
      "/settings",
    );
    expect(normalizeLocalizedRedirectPath("/en", "en")).toBe("/");
    expect(normalizeLocalizedRedirectPath("/en?from=login", "en")).toBe(
      "/?from=login",
    );
    expect(normalizeLocalizedRedirectPath("/en#section", "en")).toBe(
      "/#section",
    );
    expect(normalizeLocalizedRedirectPath("/enterprise", "en")).toBe(
      "/enterprise",
    );
    expect(normalizeLocalizedRedirectPath("/english/docs", "en")).toBe(
      "/english/docs",
    );
    expect(normalizeLocalizedRedirectPath("/de/settings", "en")).toBe(
      "/de/settings",
    );
    expect(normalizeLocalizedRedirectPath("https://evil.test", "en")).toBe(
      "/",
    );
  });

  it("normalizes API error code values", () => {
    expect(normalizeApiErrorCode(" INVALID_INPUT ")).toBe("invalid_input");
    expect(normalizeApiErrorCode(" ")).toBeNull();
    expect(normalizeApiErrorCode(401)).toBeNull();
  });

  it("reads normalized API error codes from error or code response fields", async () => {
    await expect(
      readApiErrorCode(
        new Response(JSON.stringify({ error: " INVALID_USERNAME " })),
      ),
    ).resolves.toBe("invalid_username");
    await expect(
      readApiErrorCode(new Response(JSON.stringify({ code: "EMAIL_IN_USE" }))),
    ).resolves.toBe("email_in_use");
    await expect(
      readApiErrorCode(new Response("not-json")),
    ).resolves.toBeNull();
  });

  it("maps setup API errors to setup translation keys", () => {
    expect(mapSetupApiErrorToMessageKey(null)).toBe("error_setup_failed");
    expect(mapSetupApiErrorToMessageKey("invalid_setup_token")).toBe(
      "error_invalid_setup_token",
    );
    expect(mapSetupApiErrorToMessageKey("provider_not_configured")).toBe(
      "error_setup_provider_not_configured",
    );
    expect(mapSetupApiErrorToMessageKey("unknown")).toBe("error_setup_failed");
  });

  it("maps register social precheck errors to register translation keys", () => {
    expect(mapRegisterSocialPrecheckErrorToMessageKey(null)).toBe(
      "error_social_login_failed",
    );
    expect(mapRegisterSocialPrecheckErrorToMessageKey("email_in_use")).toBe(
      "error_setup_email_in_use",
    );
    expect(
      mapRegisterSocialPrecheckErrorToMessageKey("provider_not_configured"),
    ).toBe("error_setup_provider_not_configured");
    expect(mapRegisterSocialPrecheckErrorToMessageKey("unknown")).toBe(
      "error_social_login_failed",
    );
  });
});
