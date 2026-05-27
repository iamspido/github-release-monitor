import { describe, expect, it } from "vitest";
import { buildAuthAccess, getAuthenticationMethod } from "@/lib/auth/mode";

describe("auth/mode", () => {
  it("defaults to Basic", () => {
    expect(getAuthenticationMethod({})).toBe("Basic");
  });

  it("parses supported authentication methods", () => {
    expect(
      getAuthenticationMethod({
        AUTHENTICATION_METHOD: "AllowUnauthenticated",
      }),
    ).toBe("AllowUnauthenticated");
    expect(getAuthenticationMethod({ AUTHENTICATION_METHOD: "External" })).toBe(
      "External",
    );
  });

  it("falls back to Basic for unknown values", () => {
    expect(getAuthenticationMethod({ AUTHENTICATION_METHOD: "Nope" })).toBe(
      "Basic",
    );
  });

  it("builds unauthenticated read-only access for AllowUnauthenticated", () => {
    expect(buildAuthAccess("AllowUnauthenticated", false)).toMatchObject({
      canMutate: false,
      canAccessRestrictedPages: false,
      showLogin: true,
      showLogout: false,
      showSettings: false,
      showTest: false,
    });
  });

  it("builds full access for External without internal login state", () => {
    expect(buildAuthAccess("External", false)).toMatchObject({
      canMutate: true,
      canAccessRestrictedPages: true,
      showLogin: false,
      showLogout: false,
      showSettings: true,
      showTest: true,
    });
  });
});
