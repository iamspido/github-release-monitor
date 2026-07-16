import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

describe("secret reveal nonce store", () => {
  it("keeps a consumed nonce rejected after the module reloads", async () => {
    const nonce = randomUUID();
    const expiresAt = Date.now() + 60_000;
    const firstStore = await import(
      "@/lib/diagnostics/secret-reveal-nonce-store"
    );

    expect(firstStore.consumeSecretRevealStepUpNonce(nonce, expiresAt)).toBe(
      true,
    );

    vi.resetModules();
    const reloadedStore = await import(
      "@/lib/diagnostics/secret-reveal-nonce-store"
    );
    expect(reloadedStore.consumeSecretRevealStepUpNonce(nonce, expiresAt)).toBe(
      false,
    );
  });

  it("rejects already expired nonces without persisting them", async () => {
    const { consumeSecretRevealStepUpNonce } = await import(
      "@/lib/diagnostics/secret-reveal-nonce-store"
    );

    expect(consumeSecretRevealStepUpNonce(randomUUID(), Date.now() - 1)).toBe(
      false,
    );
  });
});
