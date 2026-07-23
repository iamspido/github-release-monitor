import { test as base } from "./ensureLoggedIn";

export const test = base.extend({
  testRepo: true,
});

export * from "./ensureLoggedIn";
