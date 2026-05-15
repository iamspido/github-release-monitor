// @vitest-environment jsdom
import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let networkState = { isOnline: true };
const linkSocialMock = vi.fn();
const unlinkAccountMock = vi.fn();
const listAccountsMock = vi.fn();
// Required for React act() in this test environment
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) => {
    const map: Record<string, string> = {
      social_accounts_title: 'Social login linking',
      social_accounts_description: 'Link providers',
      social_accounts_loading: 'Loading linked accounts...',
      social_accounts_link_error: 'LINK_ERROR',
      social_accounts_unlink_error: 'UNLINK_ERROR',
      social_accounts_status_error: 'STATUS_ERROR',
      social_accounts_unlink_button: 'Unlink account',
      social_accounts_connect_button: `Link ${values?.provider ?? ''}`.trim(),
      social_accounts_connected_button: `${values?.provider ?? ''} connected`.trim(),
    };
    return map[key] ?? key;
  },
}));

vi.mock('@/hooks/use-network', () => ({
  useNetworkStatus: () => networkState,
}));

vi.mock('@/lib/auth-client', () => ({
  authClient: {
    linkSocial: (...args: unknown[]) => linkSocialMock(...args),
    unlinkAccount: (...args: unknown[]) => unlinkAccountMock(...args),
    listAccounts: (...args: unknown[]) => listAccountsMock(...args),
  },
}));

describe('SocialAccountsSettingsCard', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    networkState = { isOnline: true };
    linkSocialMock.mockReset();
    unlinkAccountMock.mockReset();
    listAccountsMock.mockReset();
    linkSocialMock.mockResolvedValue({});
    unlinkAccountMock.mockResolvedValue({});
    listAccountsMock.mockResolvedValue({ data: [] });
    window.history.pushState({}, '', '/de/settings');
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  async function renderCard(providers: Array<'github' | 'google'>) {
    const { SocialAccountsSettingsCard } = await import(
      '@/components/social-accounts-settings-card'
    );
    await act(async () => {
      root.render(<SocialAccountsSettingsCard enabledSocialProviders={providers} />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it('renders nothing when no providers are enabled', async () => {
    await renderCard([]);
    expect(container.textContent?.trim()).toBe('');
  });

  it('starts linking for github with current pathname callback', async () => {
    await renderCard(['github']);
    const button = Array.from(container.querySelectorAll('button')).find(
      (el) => el.textContent?.includes('Link GitHub'),
    ) as HTMLButtonElement | undefined;
    expect(button).toBeTruthy();

    await act(async () => {
      button?.click();
      await Promise.resolve();
    });

    expect(linkSocialMock).toHaveBeenCalledWith({
      provider: 'github',
      callbackURL: '/de/settings',
    });
  });

  it('shows unlink action for already linked providers', async () => {
    listAccountsMock.mockResolvedValueOnce({
      data: [{ providerId: 'github' }],
    });
    await renderCard(['github', 'google']);

    const githubButton = Array.from(container.querySelectorAll('button')).find(
      (el) => el.textContent?.includes('Unlink account'),
    ) as HTMLButtonElement | undefined;
    const googleButton = Array.from(container.querySelectorAll('button')).find(
      (el) => el.textContent?.includes('Link Google'),
    ) as HTMLButtonElement | undefined;

    expect(githubButton).toBeTruthy();
    expect(githubButton?.disabled).toBe(false);
    expect(googleButton?.disabled).toBe(false);
  });

  it('detects linked providers from nested response shape (data.accounts)', async () => {
    listAccountsMock.mockResolvedValueOnce({
      data: {
        accounts: [{ provider: { id: 'google' } }],
      },
    });
    await renderCard(['github', 'google']);

    const googleButton = Array.from(container.querySelectorAll('button')).find(
      (el) => el.textContent?.includes('Unlink account'),
    ) as HTMLButtonElement | undefined;
    const githubButton = Array.from(container.querySelectorAll('button')).find(
      (el) => el.textContent?.includes('Link GitHub'),
    ) as HTMLButtonElement | undefined;

    expect(googleButton).toBeTruthy();
    expect(googleButton?.disabled).toBe(false);
    expect(githubButton?.disabled).toBe(false);
  });

  it('unlinks provider by providerId', async () => {
    listAccountsMock.mockResolvedValueOnce({
      data: [{ id: 'acc_github_1', providerId: 'github' }],
    });
    await renderCard(['github']);

    const unlinkButton = Array.from(container.querySelectorAll('button')).find(
      (el) => el.textContent?.includes('Unlink account'),
    ) as HTMLButtonElement | undefined;
    expect(unlinkButton).toBeTruthy();

    await act(async () => {
      unlinkButton?.click();
      await Promise.resolve();
    });

    expect(unlinkAccountMock).toHaveBeenCalledWith({
      providerId: 'github',
    });
  });

  it('shows error message when unlinkAccount returns error', async () => {
    listAccountsMock.mockResolvedValueOnce({
      data: [{ providerId: 'google' }],
    });
    unlinkAccountMock.mockResolvedValueOnce({ error: { code: 'bad' } });
    await renderCard(['google']);
    const button = Array.from(container.querySelectorAll('button')).find(
      (el) => el.textContent?.includes('Unlink account'),
    ) as HTMLButtonElement | undefined;

    await act(async () => {
      button?.click();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('UNLINK_ERROR');
  });

  it('shows error message when linkSocial returns error', async () => {
    linkSocialMock.mockResolvedValueOnce({ error: { code: 'bad' } });
    await renderCard(['google']);
    const button = Array.from(container.querySelectorAll('button')).find(
      (el) => el.textContent?.includes('Link Google'),
    ) as HTMLButtonElement | undefined;

    await act(async () => {
      button?.click();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('LINK_ERROR');
  });

  it('disables linking buttons while offline', async () => {
    networkState = { isOnline: false };
    await renderCard(['github', 'google']);
    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons.length).toBe(2);
    expect(buttons.every((button) => (button as HTMLButtonElement).disabled)).toBe(
      true,
    );
  });
});
