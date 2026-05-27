import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("background polling env gating", () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...envBackup };
  });
  afterEach(() => {
    process.env = { ...envBackup };
  });

  it("does not initialize polling when not in production", async () => {
    process.env.NODE_ENV = "test";
    const timeoutSpy = vi.spyOn(global, "setTimeout");
    const { startBackgroundWorkers } = await import(
      "@/lib/runtime/background-workers"
    );
    startBackgroundWorkers();
    expect(timeoutSpy).not.toHaveBeenCalled();
    timeoutSpy.mockRestore();
  });

  it("does not re-initialize when BACKGROUND_POLLING_INITIALIZED is set", async () => {
    process.env.NODE_ENV = "production";
    process.env.BACKGROUND_POLLING_INITIALIZED = "true";
    // Prevent the separate update checker from scheduling during this test scenario.
    process.env.APP_UPDATE_CHECK_INITIALIZED = "true";
    const timeoutSpy = vi.spyOn(global, "setTimeout");
    const { startBackgroundWorkers } = await import(
      "@/lib/runtime/background-workers"
    );
    startBackgroundWorkers();
    expect(timeoutSpy).not.toHaveBeenCalled();
    timeoutSpy.mockRestore();
  });
});
