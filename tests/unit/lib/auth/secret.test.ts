import { secretsEqual } from "@/lib/auth/secret";

describe("auth/secret", () => {
  it("compares equal secrets", () => {
    expect(secretsEqual("same-secret", "same-secret")).toBe(true);
  });

  it("rejects different secrets and byte lengths", () => {
    expect(secretsEqual("same-secret", "other-secret")).toBe(false);
    expect(secretsEqual("short", "a-longer-secret")).toBe(false);
    expect(secretsEqual("ä", "aa")).toBe(false);
  });
});
