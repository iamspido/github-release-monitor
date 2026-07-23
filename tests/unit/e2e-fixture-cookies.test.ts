// vitest globals enabled

import {
  getTestRepoBaselineCookieName,
  hasAuthenticationSessionCookie,
  hasTestRepoBaselineCookie,
} from "../e2e/fixtures/cookies";

describe("E2E fixture cookies", () => {
  it.each(["better-auth.session_token", "__Secure-better-auth.session_token"])(
    "recognizes the %s session cookie",
    (name) => {
      expect(hasAuthenticationSessionCookie([{ name }])).toBe(true);
    },
  );

  it("rejects unrelated cookies", () => {
    expect(hasAuthenticationSessionCookie([{ name: "NEXT_LOCALE" }])).toBe(
      false,
    );
  });

  it("recognizes only the test-repository baseline marker", () => {
    expect(
      hasTestRepoBaselineCookie([{ name: getTestRepoBaselineCookieName() }]),
    ).toBe(true);
    expect(hasTestRepoBaselineCookie([{ name: "NEXT_LOCALE" }])).toBe(false);
  });
});
