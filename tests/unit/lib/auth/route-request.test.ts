import {
  getAccountSelectionFromUnlinkRequest,
  getAuthActionFromPathname,
  getOAuthErrorFromResponseLocation,
  getOAuthProviderFromAction,
  getPasskeyIdFromDeleteRequest,
  getSocialProviderFromSignInRequest,
  isSocialAuthAction,
  isSocialSignInAction,
} from "@/lib/auth/route-request";

describe("auth route request parsing", () => {
  it("classifies Better Auth route actions", () => {
    expect(getAuthActionFromPathname("/api/auth/callback/github")).toBe(
      "callback/github",
    );
    expect(getAuthActionFromPathname("/api/auth/")).toBe("(root)");
    expect(getOAuthProviderFromAction("callback/github")).toBe("github");
    expect(getOAuthProviderFromAction("sign-in/social")).toBeNull();
    expect(isSocialAuthAction("callback/google")).toBe(true);
    expect(isSocialSignInAction("sign-in/social")).toBe(true);
  });

  it("reads social providers from supported request bodies", async () => {
    const jsonRequest = new Request(
      "http://localhost/api/auth/sign-in/social",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: " GitHub " }),
      },
    );
    const formRequest = new Request(
      "http://localhost/api/auth/sign-in/social",
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "provider=Google",
      },
    );

    expect(await getSocialProviderFromSignInRequest(jsonRequest)).toBe(
      "github",
    );
    expect(await getSocialProviderFromSignInRequest(formRequest)).toBe(
      "google",
    );
  });

  it("validates account and passkey deletion bodies", async () => {
    const unlinkRequest = new Request("http://localhost/api/auth/unlink", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ providerId: "github", accountId: "account-1" }),
    });
    const passkeyRequest = new Request("http://localhost/api/auth/passkey", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: " key-1 " }),
    });

    expect(await getAccountSelectionFromUnlinkRequest(unlinkRequest)).toEqual({
      providerId: "github",
      accountId: "account-1",
    });
    expect(await getPasskeyIdFromDeleteRequest(passkeyRequest)).toBe("key-1");
  });

  it("extracts OAuth errors only from valid response locations", () => {
    expect(
      getOAuthErrorFromResponseLocation(
        new Response(null, {
          headers: { location: "/login?error=access_denied" },
        }),
      ),
    ).toBe("access_denied");
    expect(getOAuthErrorFromResponseLocation(new Response())).toBeNull();
  });
});
