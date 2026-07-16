import {
  buildSecretRevealCallbackUrl,
  getSecretRevealTargetFromSessionStorage,
  normalizeSecretRevealTarget,
  SECRET_REVEAL_TARGET_STORAGE_KEY,
} from "@/components/diagnostics/secret-reveal-model";

describe("secret-reveal-model", () => {
  it("normalizes persisted reveal targets", () => {
    expect(normalizeSecretRevealTarget("apprise_url")).toBe("apprise_url");
    expect(normalizeSecretRevealTarget("mail_password")).toBe("mail_password");
    expect(normalizeSecretRevealTarget("unknown")).toBe("mail_password");
    expect(normalizeSecretRevealTarget(null)).toBe("mail_password");
  });

  it("reads and clears the session storage target", () => {
    const values = new Map([[SECRET_REVEAL_TARGET_STORAGE_KEY, "apprise_url"]]);
    const storage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      removeItem: vi.fn((key: string) => values.delete(key)),
    };

    expect(getSecretRevealTargetFromSessionStorage(storage)).toBe(
      "apprise_url",
    );
    expect(storage.removeItem).toHaveBeenCalledWith(
      SECRET_REVEAL_TARGET_STORAGE_KEY,
    );
  });

  it("builds the social step-up callback URL", () => {
    expect(buildSecretRevealCallbackUrl("/de/test")).toBe(
      "/de/test?secretRevealStepUp=1",
    );
    expect(buildSecretRevealCallbackUrl("")).toBe("/test?secretRevealStepUp=1");
  });
});
