// @vitest-environment jsdom
import React from "react";
import ReactDOM from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let searchParams = new URLSearchParams();
const socialSignInMock = vi.fn();

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParams,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) => {
    const map: Record<string, string> = {
      form_title: "Welcome Back",
      form_description: "Enter your credentials.",
      identifier_label: "Identifier",
      password_label: "Password",
      login_button: "Login",
      checking_setup: "Checking setup...",
      alternative_login_divider: "Or continue with",
      social_provider_github: "GitHub",
      social_sign_in_button: `Sign in with ${values?.provider ?? ""}`.trim(),
      social_identifier_label: "Username or email (for social login)",
      social_identifier_placeholder: "admin or admin@example.com",
      social_login_requires_link_notice:
        "Social sign-in works only for already linked accounts.",
      error_social_login_unavailable:
        "Social login is not available for this account.",
    };
    return map[key] ?? key;
  },
}));

vi.mock("@/app/auth/actions", () => ({
  login: vi.fn(),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    signIn: {
      social: socialSignInMock,
      passkey: vi.fn(),
    },
    twoFactor: {
      verifyTotp: vi.fn(),
    },
  },
}));

describe("LoginForm social precheck", () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    searchParams = new URLSearchParams();
    socialSignInMock.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    fetchMock = vi.fn((input: RequestInfo | URL) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof Request
              ? input.url
              : input.toString();
        if (url === "/api/auth/setup") {
          return Promise.resolve({
            ok: false,
            status: 404,
            json: async () => ({}),
          });
        }
        if (url === "/api/auth/social/precheck") {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ canProceed: false }),
          });
        }
        return Promise.reject(new Error(`Unexpected fetch URL: ${url}`));
      });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
  });

  async function renderForm(options?: { signupEnabled?: boolean }) {
    const signupEnabled = options?.signupEnabled ?? false;
    const { LoginForm } = await import("@/components/auth/login-form");
    await act(async () => {
      root.render(
        <LoginForm
          locale="en"
          enabledSocialProviders={["github"]}
          passkeyEnabled={false}
          signupEnabled={signupEnabled}
          registerPath="/en/register"
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  function setControlledInputValue(input: HTMLInputElement, value: string) {
    const descriptor = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    );
    descriptor?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  it("does not start social oauth when precheck denies account", async () => {
    await renderForm();

    const socialIdentifierInput = container.querySelector(
      'input[name="socialIdentifier"]',
    ) as HTMLInputElement | null;
    expect(socialIdentifierInput).toBeTruthy();

    await act(async () => {
      if (socialIdentifierInput) {
        setControlledInputValue(socialIdentifierInput, "admin");
      }
      await Promise.resolve();
    });

    const socialButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Sign in with GitHub"),
    ) as HTMLButtonElement | undefined;
    expect(socialButton).toBeTruthy();
    expect(socialButton?.disabled).toBe(false);

    await act(async () => {
      socialButton?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      fetchMock.mock.calls.some((call) => {
        const input = call[0];
        if (typeof input === "string") {
          return input === "/api/auth/social/precheck";
        }
        if (input instanceof Request) {
          return input.url.endsWith("/api/auth/social/precheck");
        }
        return input.toString().endsWith("/api/auth/social/precheck");
      }),
    ).toBe(true);
    expect(socialSignInMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain(
      "Social login is not available for this account.",
    );
  });

  it("keeps social identifier and precheck active when signup is enabled", async () => {
    await renderForm({ signupEnabled: true });

    const socialIdentifierInput = container.querySelector(
      'input[name="socialIdentifier"]',
    ) as HTMLInputElement | null;
    expect(socialIdentifierInput).toBeTruthy();

    await act(async () => {
      if (socialIdentifierInput) {
        setControlledInputValue(socialIdentifierInput, "admin");
      }
      await Promise.resolve();
    });

    const socialButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Sign in with GitHub"),
    ) as HTMLButtonElement | undefined;
    expect(socialButton).toBeTruthy();
    expect(socialButton?.disabled).toBe(false);

    await act(async () => {
      socialButton?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      fetchMock.mock.calls.some((call) => {
        const input = call[0];
        if (typeof input === "string") {
          return input === "/api/auth/social/precheck";
        }
        if (input instanceof Request) {
          return input.url.endsWith("/api/auth/social/precheck");
        }
        return input.toString().endsWith("/api/auth/social/precheck");
      }),
    ).toBe(true);
    expect(socialSignInMock).not.toHaveBeenCalled();
  });
});
