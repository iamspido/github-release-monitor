// @vitest-environment jsdom
import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let searchParams = new URLSearchParams();
// Required for React act() in this test environment
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('next/navigation', () => ({
  useSearchParams: () => searchParams,
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => {
    const map: Record<string, string> = {
      form_title: 'Welcome Back',
      form_description: 'Enter your credentials.',
      identifier_label: 'Identifier',
      password_label: 'Password',
      login_button: 'Login',
      checking_setup: 'Checking setup...',
      error_social_signup_disabled: 'SOCIAL_SIGNUP_DISABLED',
      error_social_state_mismatch: 'SOCIAL_STATE_MISMATCH',
      error_social_login_failed: 'SOCIAL_LOGIN_FAILED',
    };
    return map[key] ?? key;
  },
}));

vi.mock('@/app/auth/actions', () => ({
  login: vi.fn(),
}));

vi.mock('@/lib/auth-client', () => ({
  authClient: {
    signIn: {
      social: vi.fn(),
      passkey: vi.fn(),
    },
  },
}));

describe('LoginForm OAuth error mapping', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    vi.stubGlobal(
      'fetch',
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

  async function renderWithError(errorCode: string) {
    searchParams = new URLSearchParams({
      error: errorCode,
    });

    const { LoginForm } = await import('@/components/auth/login-form');
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

  it('shows dedicated message for signup_disabled', async () => {
    await renderWithError('signup_disabled');
    expect(container.textContent).toContain('SOCIAL_SIGNUP_DISABLED');
  });

  it('shows dedicated message for state_mismatch', async () => {
    await renderWithError('state_mismatch');
    expect(container.textContent).toContain('SOCIAL_STATE_MISMATCH');
  });

  it('falls back to generic social login error for unknown code', async () => {
    await renderWithError('unknown_error_code');
    expect(container.textContent).toContain('SOCIAL_LOGIN_FAILED');
  });
});
