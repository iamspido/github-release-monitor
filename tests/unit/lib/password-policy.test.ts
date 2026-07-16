import {
  containsPasswordWhitespace,
  isPasswordPolicyValid,
  keepPasswordInputWhitespaceFree,
} from "@/lib/password-policy";

describe("password policy", () => {
  it("accepts a strong password without whitespace", () => {
    expect(isPasswordPolicyValid("VerySecurePass123")).toBe(true);
  });

  it.each([
    " VerySecurePass123",
    "VerySecurePass123 ",
    "Very SecurePass123",
    "VerySecure\tPass123",
    "VerySecure\nPass123",
    "VerySecure\u00a0Pass123",
  ])("rejects whitespace in new passwords: %j", (password) => {
    expect(containsPasswordWhitespace(password)).toBe(true);
    expect(isPasswordPolicyValid(password)).toBe(false);
  });

  it("keeps the previous input value when an edit contains whitespace", () => {
    expect(
      keepPasswordInputWhitespaceFree("VerySecure", "Very SecurePass123"),
    ).toBe("VerySecure");
    expect(
      keepPasswordInputWhitespaceFree("VerySecure", "VerySecurePass123"),
    ).toBe("VerySecurePass123");
  });
});
