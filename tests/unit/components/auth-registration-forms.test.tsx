// @vitest-environment jsdom
import { act } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let searchParams = new URLSearchParams();
const startRegistrationSocialFlowMock = vi.fn();
const startSetupSocialFlowMock = vi.fn();
const submitSetupMock = vi.fn();

vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParams,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) => {
    const map: Record<string, string> = {
      social_provider_github: "GitHub",
      social_provider_google: "Google",
      social_sign_in_button: `Continue with ${values?.provider ?? ""}`.trim(),
      error_social_login_failed: "SOCIAL_LOGIN_FAILED",
      error_social_state_mismatch: "SOCIAL_STATE_MISMATCH",
      error_setup_invalid_username: "INVALID_USERNAME",
      error_invalid_setup_token: "INVALID_SETUP_TOKEN",
      error_setup_failed: "SETUP_FAILED",
    };
    return map[key] ?? key;
  },
}));

vi.mock("@/app/auth/actions", () => ({
  register: vi.fn(),
}));

vi.mock("@/lib/auth/client-flow-utils", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/auth/client-flow-utils")>();
  return {
    ...original,
    submitSetup: (...args: unknown[]) => submitSetupMock(...args),
  };
});

vi.mock("@/lib/auth/client-social-flow", () => ({
  startRegistrationSocialFlow: (...args: unknown[]) =>
    startRegistrationSocialFlowMock(...args),
  startSetupSocialFlow: (...args: unknown[]) =>
    startSetupSocialFlowMock(...args),
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function setInputValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("registration and initial setup forms", () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    searchParams = new URLSearchParams();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    startRegistrationSocialFlowMock.mockReset();
    startSetupSocialFlowMock.mockReset();
    submitSetupMock.mockReset();
    startRegistrationSocialFlowMock.mockResolvedValue({ status: "started" });
    startSetupSocialFlowMock.mockResolvedValue({ status: "started" });
    submitSetupMock.mockResolvedValue("success");
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("normalizes registration fields before starting social signup", async () => {
    const { RegisterForm } = await import("@/components/auth/register-form");
    await act(async () => {
      root.render(
        <RegisterForm
          loginPath="/en/login"
          enabledSocialProviders={["github"]}
        />,
      );
    });
    const username = container.querySelector(
      'input[name="username"]',
    ) as HTMLInputElement;
    const email = container.querySelector(
      'input[name="email"]',
    ) as HTMLInputElement;
    const socialButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Continue with GitHub"),
    ) as HTMLButtonElement;
    expect(socialButton.disabled).toBe(true);

    await act(async () => {
      setInputValue(username, " Admin.User ");
      setInputValue(email, " ADMIN@EXAMPLE.TEST ");
    });
    expect(socialButton.disabled).toBe(false);

    await act(async () => {
      socialButton.click();
      await Promise.resolve();
    });

    expect(startRegistrationSocialFlowMock).toHaveBeenCalledWith({
      provider: "github",
      username: "Admin.User",
      email: "admin@example.test",
    });
  });

  it("shows client and OAuth registration errors", async () => {
    searchParams = new URLSearchParams({ error: "state_mismatch" });
    startRegistrationSocialFlowMock.mockResolvedValue({
      status: "error",
      errorKey: "error_social_login_failed",
    });
    const { RegisterForm } = await import("@/components/auth/register-form");
    await act(async () => {
      root.render(
        <RegisterForm
          loginPath="/en/login"
          enabledSocialProviders={["github"]}
        />,
      );
    });
    expect(container.textContent).toContain("SOCIAL_STATE_MISMATCH");
    const username = container.querySelector(
      'input[name="username"]',
    ) as HTMLInputElement;
    const socialButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Continue with GitHub"),
    ) as HTMLButtonElement;
    await act(async () => setInputValue(username, "valid.user"));
    await act(async () => {
      socialButton.click();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("SOCIAL_LOGIN_FAILED");
  });

  it("submits normalized initial account data and reports completion", async () => {
    const onCompleted = vi.fn();
    const onUnavailable = vi.fn();
    const { InitialSetupForm } = await import(
      "@/components/auth/initial-setup-form"
    );
    await act(async () => {
      root.render(
        <InitialSetupForm
          enabledSocialProviders={[]}
          safeNext="/settings"
          allowUnauthenticatedAccess={false}
          publicHomePath="/"
          externalErrorKey={null}
          onCompleted={onCompleted}
          onUnavailable={onUnavailable}
        />,
      );
    });
    const values: Record<string, string> = {
      setupToken: " setup-secret ",
      name: " Administrator ",
      username: " Admin.User ",
      email: " ADMIN@EXAMPLE.TEST ",
      password: "VeryStrongPass123",
    };
    await act(async () => {
      for (const [name, value] of Object.entries(values)) {
        setInputValue(
          container.querySelector(`input[name="${name}"]`) as HTMLInputElement,
          value,
        );
      }
    });

    await act(async () => {
      container
        .querySelector("form")
        ?.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
      await Promise.resolve();
    });

    expect(submitSetupMock).toHaveBeenCalledWith({
      token: "setup-secret",
      email: "admin@example.test",
      password: "VeryStrongPass123",
      name: "Administrator",
      username: "Admin.User",
    });
    expect(onCompleted).toHaveBeenCalledWith("Admin.User");
    expect(onUnavailable).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid_token", "INVALID_SETUP_TOKEN"],
    [{ errorKey: "error_setup_failed" }, "SETUP_FAILED"],
  ])("shows setup result errors for %s", async (result, message) => {
    submitSetupMock.mockResolvedValue(result);
    const { InitialSetupForm } = await import(
      "@/components/auth/initial-setup-form"
    );
    await act(async () => {
      root.render(
        <InitialSetupForm
          enabledSocialProviders={[]}
          safeNext={undefined}
          allowUnauthenticatedAccess={false}
          publicHomePath="/"
          externalErrorKey={null}
          onCompleted={vi.fn()}
          onUnavailable={vi.fn()}
        />,
      );
    });
    await act(async () => {
      container
        .querySelector("form")
        ?.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
      await Promise.resolve();
    });

    expect(container.textContent).toContain(message);
  });

  it("starts social setup with trimmed context and handles unavailability", async () => {
    startSetupSocialFlowMock.mockResolvedValue({ status: "unavailable" });
    const onUnavailable = vi.fn();
    const { InitialSetupForm } = await import(
      "@/components/auth/initial-setup-form"
    );
    await act(async () => {
      root.render(
        <InitialSetupForm
          enabledSocialProviders={["github"]}
          safeNext="/settings"
          allowUnauthenticatedAccess={false}
          publicHomePath="/"
          externalErrorKey={null}
          onCompleted={vi.fn()}
          onUnavailable={onUnavailable}
        />,
      );
    });
    await act(async () => {
      setInputValue(
        container.querySelector('input[name="setupToken"]') as HTMLInputElement,
        " setup-secret ",
      );
      setInputValue(
        container.querySelector('input[name="name"]') as HTMLInputElement,
        " Administrator ",
      );
      setInputValue(
        container.querySelector('input[name="username"]') as HTMLInputElement,
        " Admin.User ",
      );
    });
    const socialButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Continue with GitHub"),
    ) as HTMLButtonElement;

    await act(async () => {
      socialButton.click();
      await Promise.resolve();
    });

    expect(startSetupSocialFlowMock).toHaveBeenCalledWith({
      token: "setup-secret",
      provider: "github",
      username: "Admin.User",
      name: "Administrator",
      callbackURL: "/settings",
    });
    expect(onUnavailable).toHaveBeenCalledWith("error_setup_unavailable");
  });
});
