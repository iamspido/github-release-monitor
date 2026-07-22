import { login } from "../utils";
import { test as base } from "./test";

type LoggedInFixtures = {
  loginIfNeeded: () => Promise<void>;
};

export const test = base.extend<LoggedInFixtures>({
  loginIfNeeded: async ({ page }, use) => {
    await login(page);
    await use(async () => {});
  },
});
