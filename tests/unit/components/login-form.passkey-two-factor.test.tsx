// @vitest-environment jsdom
import { act } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const submitPasswordLoginMock = vi.fn();
const passkeySignInMock = vi.fn();
const verifyTotpMock = vi.fn();
const navigateToClientPathMock = vi.fn();

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("next=%2Fsettings"),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => {
    const messages: Record<string, string> = {
      form_title: "Welcome Back",
      form_description: "Enter your credentials.",
      identifier_label: "Identifier",
      identifier_placeholder: "Username or email",
      password_label: "Password",
      password_placeholder: "Password",
      login_button: "Login",
      show_password: "Show password",
      hide_password: "Hide password",
      alternative_login_divider: "Or continue with",
      passkey_login_button: "Sign in with passkey",
      two_factor_login_prompt: "Enter your two-factor code.",
      two_factor_login_code_label: "Two-factor code",
      two_factor_login_code_placeholder: "123456",
      two_factor_login_verify_button: "Verify code",
      error_passkey_login_failed: "Passkey login failed.",
      error_two_factor_invalid: "Invalid two-factor code.",
    };
    return messages[key] ?? key;
  },
}));

vi.mock("@/components/auth/use-setup-requirement", () => ({
  useSetupRequirement: () => ({
    setupLoading: false,
    setupRequired: false,
    setSetupRequired: vi.fn(),
  }),
}));

vi.mock("@/lib/auth/client-flow-utils", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/auth/client-flow-utils")>();
  return {
    ...actual,
    navigateToClientPath: (...args: unknown[]) =>
      navigateToClientPathMock(...args),
    submitPasswordLogin: (...args: unknown[]) =>
      submitPasswordLoginMock(...args),
  };
});

vi.mock("@/lib/auth/client", () => ({
  authClient: {
    signIn: {
      passkey: (...args: unknown[]) => passkeySignInMock(...args),
    },
    twoFactor: {
      verifyTotp: (...args: unknown[]) => verifyTotpMock(...args),
    },
  },
}));

describe("LoginForm passkey and two-factor flows", () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  let warnMock: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    submitPasswordLoginMock.mockReset();
    passkeySignInMock.mockReset();
    verifyTotpMock.mockReset();
    navigateToClientPathMock.mockReset();
    passkeySignInMock.mockResolvedValue({});
    verifyTotpMock.mockResolvedValue({});
    warnMock = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: true,
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    warnMock.mockRestore();
  });

  async function renderForm() {
    const { LoginForm } = await import("@/components/auth/login-form");
    await act(async () => {
      root.render(
        <LoginForm
          locale="en"
          enabledSocialProviders={[]}
          passkeyEnabled
          signupEnabled={false}
          registerPath="/register"
        />,
      );
    });
  }

  function setInputValue(input: HTMLInputElement, value: string) {
    const descriptor = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    );
    descriptor?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function findButton(label: string) {
    return Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes(label),
    );
  }

  it("submits password credentials and switches to two-factor verification", async () => {
    submitPasswordLoginMock.mockResolvedValue({ requiresTwoFactor: true });
    verifyTotpMock.mockResolvedValue({
      error: { message: "invalid code" },
    });
    await renderForm();

    const identifier = container.querySelector(
      'input[name="email"]',
    ) as HTMLInputElement;
    const password = container.querySelector(
      'input[name="password"]',
    ) as HTMLInputElement;
    await act(async () => {
      setInputValue(identifier, "release_user");
      setInputValue(password, "SecretPassword123");
      container
        .querySelector("form")
        ?.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
      await Promise.resolve();
    });

    expect(submitPasswordLoginMock).toHaveBeenCalledWith({
      identifier: "release_user",
      password: "SecretPassword123",
      next: "/settings",
      locale: "en",
    });
    expect(container.textContent).toContain("Enter your two-factor code.");
    expect(container.textContent).not.toContain("Sign in with passkey");

    const code = container.querySelector(
      'input[autocomplete="one-time-code"]',
    ) as HTMLInputElement;
    await act(async () => {
      setInputValue(code, " 123456 ");
      findButton("Verify code")?.click();
      await Promise.resolve();
    });

    expect(verifyTotpMock).toHaveBeenCalledWith({
      code: "123456",
      trustDevice: true,
    });
    expect(container.textContent).toContain("Invalid two-factor code.");
  });

  it("redirects after a successful password login", async () => {
    submitPasswordLoginMock.mockResolvedValue({
      redirectTo: "/en/settings",
    });
    await renderForm();
    const identifier = container.querySelector(
      'input[name="email"]',
    ) as HTMLInputElement;
    const password = container.querySelector(
      'input[name="password"]',
    ) as HTMLInputElement;

    await act(async () => {
      setInputValue(identifier, "release_user");
      setInputValue(password, "SecretPassword123");
      container
        .querySelector("form")
        ?.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(navigateToClientPathMock).toHaveBeenCalledWith("/en/settings");
  });

  it("redirects to the safe next path after a successful passkey login", async () => {
    await renderForm();

    await act(async () => {
      findButton("Sign in with passkey")?.click();
      await Promise.resolve();
    });

    expect(passkeySignInMock).toHaveBeenCalledOnce();
    expect(navigateToClientPathMock).toHaveBeenCalledWith("/settings");
  });

  it("redirects to the safe next path after successful two-factor verification", async () => {
    submitPasswordLoginMock.mockResolvedValue({ requiresTwoFactor: true });
    await renderForm();
    const identifier = container.querySelector(
      'input[name="email"]',
    ) as HTMLInputElement;
    const password = container.querySelector(
      'input[name="password"]',
    ) as HTMLInputElement;
    await act(async () => {
      setInputValue(identifier, "release_user");
      setInputValue(password, "SecretPassword123");
      container
        .querySelector("form")
        ?.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
      await Promise.resolve();
    });
    const code = container.querySelector(
      'input[autocomplete="one-time-code"]',
    ) as HTMLInputElement;

    await act(async () => {
      setInputValue(code, "123456");
      findButton("Verify code")?.click();
      await Promise.resolve();
    });

    expect(verifyTotpMock).toHaveBeenCalledWith({
      code: "123456",
      trustDevice: true,
    });
    expect(navigateToClientPathMock).toHaveBeenCalledWith("/settings");
  });

  it.each([
    ["resolved error", { error: { message: "not registered" } }],
    ["exception", new Error("browser failure")],
  ])("shows a passkey error for a %s", async (_label, result) => {
    if (result instanceof Error) {
      passkeySignInMock.mockRejectedValue(result);
    } else {
      passkeySignInMock.mockResolvedValue(result);
    }
    await renderForm();

    await act(async () => {
      findButton("Sign in with passkey")?.click();
      await Promise.resolve();
    });

    expect(passkeySignInMock).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Passkey login failed.");
  });

  it("does not submit password credentials while offline", async () => {
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: false,
    });
    await renderForm();

    await act(async () => {
      container
        .querySelector("form")
        ?.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
      await Promise.resolve();
    });

    expect(submitPasswordLoginMock).not.toHaveBeenCalled();
    expect(warnMock).toHaveBeenCalledWith("Login prevented: offline");
  });
});
