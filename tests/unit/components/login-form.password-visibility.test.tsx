// @vitest-environment jsdom
import { act } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let searchParams = new URLSearchParams();

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParams,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => {
    const map: Record<string, string> = {
      form_title: "Welcome Back",
      form_description: "Enter your credentials.",
      identifier_label: "Identifier",
      password_label: "Password",
      password_placeholder: "Password",
      login_button: "Login",
      checking_setup: "Checking setup...",
      show_password: "Show password",
      hide_password: "Hide password",
    };
    return map[key] ?? key;
  },
}));

vi.mock("@/app/auth/actions", () => ({
  login: vi.fn(),
}));

vi.mock("@/lib/auth/client", () => ({
  authClient: {
    signIn: {
      social: vi.fn(),
      passkey: vi.fn(),
    },
    twoFactor: {
      verifyTotp: vi.fn(),
    },
  },
}));

describe("LoginForm password visibility toggle", () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    searchParams = new URLSearchParams();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      }),
    );
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
  });

  async function renderForm() {
    const { LoginForm } = await import("@/components/auth/login-form");
    await act(async () => {
      root.render(
        <LoginForm
          locale="en"
          enabledSocialProviders={[]}
          passkeyEnabled={false}
          signupEnabled={false}
          registerPath="/en/register"
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("toggles login password input between masked and visible", async () => {
    await renderForm();

    const passwordInput = container.querySelector(
      'input[name="password"]',
    ) as HTMLInputElement | null;
    expect(passwordInput).toBeTruthy();
    expect(passwordInput?.type).toBe("password");

    const showButton = container.querySelector(
      'button[aria-label="Show password"]',
    ) as HTMLButtonElement | null;
    expect(showButton).toBeTruthy();

    await act(async () => {
      showButton?.click();
    });
    expect(passwordInput?.type).toBe("text");

    const hideButton = container.querySelector(
      'button[aria-label="Hide password"]',
    ) as HTMLButtonElement | null;
    expect(hideButton).toBeTruthy();

    await act(async () => {
      hideButton?.click();
    });
    expect(passwordInput?.type).toBe("password");
  });
});
