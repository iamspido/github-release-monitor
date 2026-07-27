import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const startBackgroundWorkersMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/runtime/background-workers", () => ({
  startBackgroundWorkers: startBackgroundWorkersMock,
}));

describe("instrumentation registration", () => {
  const originalRuntime = process.env.NEXT_RUNTIME;

  beforeEach(() => {
    vi.resetModules();
    startBackgroundWorkersMock.mockReset();
  });

  afterEach(() => {
    if (originalRuntime === undefined) {
      delete process.env.NEXT_RUNTIME;
    } else {
      process.env.NEXT_RUNTIME = originalRuntime;
    }
  });

  it("starts Node.js background workers exactly once", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    const { register } = await import("@/instrumentation");

    await register();
    await register();

    expect(startBackgroundWorkersMock).toHaveBeenCalledOnce();
  });

  it("does not start workers for a non-Node runtime", async () => {
    process.env.NEXT_RUNTIME = "edge";
    const { register } = await import("@/instrumentation");

    await register();

    expect(startBackgroundWorkersMock).not.toHaveBeenCalled();
  });
});
