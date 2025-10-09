import { test as base } from '@playwright/test';
import { login } from '../utils';

type LoggedInFixtures = {
  loginIfNeeded: () => Promise<void>;
};

export const test = base.extend<LoggedInFixtures>({
  loginIfNeeded: async ({ page }, use) => {
    await login(page);
    await use(async () => {});
  },
});
