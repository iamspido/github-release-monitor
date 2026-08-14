// @vitest-environment jsdom
import { act } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  requestPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
}));

let searchParams = new URLSearchParams();

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParams,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => {
    const messages: Record<string, string> = {
      title: "Password recovery",
      description: "Enter your username or email address.",
      cli_description: "Use the administration CLI.",
      cli_notice: "SMTP is not configured.",
      identifier_label: "Username or email",
      identifier_placeholder: "admin or admin@example.test",
      submit: "Continue",
      success: "If the account exists, a reset link was sent.",
      network_error: "Request failed.",
      back_to_login: "Back to login",
      password_label: "New password",
      password_requirements: "Use a strong password.",
      confirm_label: "Confirm password",
      password_mismatch: "Passwords do not match.",
      show_password: "Show password",
      hide_password: "Hide password",
      invalid_or_expired: "The link is invalid or expired.",
      reset_failed: "The password could not be reset.",
    };
    return messages[key] ?? key;
  },
}));

vi.mock("@/lib/auth/client", () => ({
  authClient: {
    requestPasswordReset: (...args: unknown[]) =>
      authMocks.requestPasswordReset(...args),
    resetPassword: (...args: unknown[]) => authMocks.resetPassword(...args),
  },
}));

describe("password recovery forms", () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    searchParams = new URLSearchParams();
    authMocks.requestPasswordReset.mockReset();
    authMocks.resetPassword.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function setInputValue(input: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  it("shows only the administrative CLI recovery when SMTP is unavailable", async () => {
    const { ForgotPasswordForm } = await import(
      "@/components/auth/forgot-password-form"
    );
    await act(async () => {
      root.render(
        <ForgotPasswordForm
          emailEnabled={false}
          loginPath="/en/login"
          resetPath="/en/reset-password"
        />,
      );
    });

    expect(container.textContent).toContain("SMTP is not configured.");
    expect(container.textContent).toContain("auth reset-password --user");
    expect(container.querySelector("input")).toBeNull();
  });

  it("uses the same neutral result when the reset API does not disclose an account", async () => {
    authMocks.requestPasswordReset.mockResolvedValue({
      data: { status: true },
      error: null,
    });
    const { ForgotPasswordForm } = await import(
      "@/components/auth/forgot-password-form"
    );
    await act(async () => {
      root.render(
        <ForgotPasswordForm
          emailEnabled
          loginPath="/en/login"
          resetPath="/en/reset-password"
        />,
      );
    });
    const identifier = container.querySelector(
      'input[name="identifier"]',
    ) as HTMLInputElement;
    await act(async () => {
      setInputValue(identifier, "Admin");
      container
        .querySelector("form")
        ?.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
      await Promise.resolve();
    });

    expect(authMocks.requestPasswordReset).toHaveBeenCalledWith({
      email: "admin",
      redirectTo: "/en/reset-password",
    });
    expect(container.textContent).toContain(
      "If the account exists, a reset link was sent.",
    );
  });

  it("shows a generic error when the reset request fails", async () => {
    authMocks.requestPasswordReset.mockResolvedValue({
      data: null,
      error: { message: "SMTP unavailable", status: 500 },
    });
    const { ForgotPasswordForm } = await import(
      "@/components/auth/forgot-password-form"
    );
    await act(async () => {
      root.render(
        <ForgotPasswordForm
          emailEnabled
          loginPath="/en/login"
          resetPath="/en/reset-password"
        />,
      );
    });
    const identifier = container.querySelector(
      'input[name="identifier"]',
    ) as HTMLInputElement;
    await act(async () => {
      setInputValue(identifier, "admin@example.test");
      container
        .querySelector("form")
        ?.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Request failed.");
    expect(container.textContent).not.toContain(
      "If the account exists, a reset link was sent.",
    );
  });

  it("rejects missing tokens and submits only matching policy-compliant passwords", async () => {
    const { ResetPasswordForm } = await import(
      "@/components/auth/reset-password-form"
    );
    await act(async () => {
      root.render(<ResetPasswordForm loginPath="/en/login" />);
    });
    expect(container.textContent).toContain("The link is invalid or expired.");

    searchParams = new URLSearchParams({ token: "one-time-token" });
    await act(async () => {
      root.render(<ResetPasswordForm loginPath="/en/login" />);
    });
    const inputs = Array.from(
      container.querySelectorAll('input[type="password"]'),
    ) as HTMLInputElement[];
    await act(async () => {
      setInputValue(inputs[0], "StrongPassword1");
      setInputValue(inputs[1], "StrongPassword2");
    });
    expect(container.textContent).toContain("Passwords do not match.");
    expect(container.querySelector('button[type="submit"]')).toHaveProperty(
      "disabled",
      true,
    );

    authMocks.resetPassword.mockResolvedValue({ error: null });
    await act(async () => {
      setInputValue(inputs[1], "StrongPassword1");
      (
        container.querySelector('button[type="submit"]') as HTMLButtonElement
      ).click();
      await Promise.resolve();
    });
    expect(authMocks.resetPassword).toHaveBeenCalledWith({
      newPassword: "StrongPassword1",
      token: "one-time-token",
    });
  });

  it("distinguishes invalid reset tokens from server failures", async () => {
    searchParams = new URLSearchParams({ token: "one-time-token" });
    const { ResetPasswordForm } = await import(
      "@/components/auth/reset-password-form"
    );
    await act(async () => {
      root.render(<ResetPasswordForm loginPath="/en/login" />);
    });
    const submitPassword = async () => {
      const inputs = Array.from(
        container.querySelectorAll('input[type="password"]'),
      ) as HTMLInputElement[];
      await act(async () => {
        setInputValue(inputs[0], "StrongPassword1");
        setInputValue(inputs[1], "StrongPassword1");
      });
      await act(async () => {
        (
          container.querySelector('button[type="submit"]') as HTMLButtonElement
        ).click();
        await Promise.resolve();
      });
    };

    authMocks.resetPassword.mockResolvedValueOnce({
      error: { status: 400, code: "INVALID_TOKEN" },
    });
    await submitPassword();
    expect(container.textContent).toContain("The link is invalid or expired.");

    authMocks.resetPassword.mockResolvedValueOnce({
      error: { status: 500 },
    });
    await submitPassword();
    expect(container.textContent).toContain("The password could not be reset.");
  });

  it("does not misreport non-token client errors as an expired link", async () => {
    searchParams = new URLSearchParams({ token: "one-time-token" });
    const { ResetPasswordForm } = await import(
      "@/components/auth/reset-password-form"
    );
    await act(async () => {
      root.render(<ResetPasswordForm loginPath="/en/login" />);
    });
    const inputs = Array.from(
      container.querySelectorAll('input[type="password"]'),
    ) as HTMLInputElement[];
    expect(inputs[0]?.maxLength).toBe(128);
    expect(inputs[1]?.maxLength).toBe(128);

    authMocks.resetPassword.mockResolvedValueOnce({
      error: { status: 400, code: "PASSWORD_TOO_LONG" },
    });
    await act(async () => {
      setInputValue(inputs[0], "StrongPassword1");
      setInputValue(inputs[1], "StrongPassword1");
    });
    await act(async () => {
      (
        container.querySelector('button[type="submit"]') as HTMLButtonElement
      ).click();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("The password could not be reset.");
    expect(container.textContent).not.toContain(
      "The link is invalid or expired.",
    );
  });
});
