// @vitest-environment jsdom
import { act, StrictMode } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type AutosaveTask,
  useAutosaveController,
} from "@/hooks/use-autosave-controller";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type Controller = ReturnType<typeof useAutosaveController>;

function Harness({ onRender }: { onRender: (value: Controller) => void }) {
  const controller = useAutosaveController();
  onRender(controller);
  return null;
}

describe("useAutosaveController", () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  let rootMounted: boolean;
  let controller: Controller;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    rootMounted = true;
    act(() => {
      root.render(<Harness onRender={(value) => (controller = value)} />);
    });
  });

  afterEach(() => {
    if (rootMounted) act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  async function advance(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  it("coalesces scheduled tasks and runs the latest after 750 ms", async () => {
    const first = vi.fn<AutosaveTask>().mockResolvedValue(true);
    const latest = vi.fn<AutosaveTask>().mockResolvedValue(true);

    act(() => controller.schedule(first));
    await advance(500);
    act(() => controller.schedule(latest));
    await advance(749);
    expect(first).not.toHaveBeenCalled();
    expect(latest).not.toHaveBeenCalled();

    await advance(1);
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledOnce();
  });

  it("runs immediate tasks without waiting", async () => {
    const task = vi.fn<AutosaveTask>().mockResolvedValue(true);

    await act(async () => {
      controller.saveNow(task);
      await Promise.resolve();
    });

    expect(task).toHaveBeenCalledOnce();
    expect(controller.status).toBe("success");
  });

  it("flushes a scheduled task immediately", async () => {
    const task = vi.fn<AutosaveTask>().mockResolvedValue(true);
    act(() => controller.schedule(task));

    await act(async () => {
      controller.flush();
      await Promise.resolve();
    });

    expect(task).toHaveBeenCalledOnce();
  });

  it("serializes requests and keeps only the latest queued task", async () => {
    let resolveFirst: ((success: boolean) => void) | undefined;
    const first = vi.fn<AutosaveTask>().mockReturnValue(
      new Promise((resolve) => {
        resolveFirst = resolve;
      }),
    );
    const discarded = vi.fn<AutosaveTask>().mockResolvedValue(true);
    const latest = vi.fn<AutosaveTask>().mockResolvedValue(true);

    act(() => controller.saveNow(first));
    act(() => controller.saveNow(discarded));
    act(() => controller.saveNow(latest));
    expect(first).toHaveBeenCalledOnce();
    expect(discarded).not.toHaveBeenCalled();
    expect(latest).not.toHaveBeenCalled();

    await act(async () => {
      resolveFirst?.(true);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(discarded).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledOnce();
  });

  it("does not start queued work after unmounting", async () => {
    let resolveFirst: ((success: boolean) => void) | undefined;
    const first = vi.fn<AutosaveTask>().mockReturnValue(
      new Promise((resolve) => {
        resolveFirst = resolve;
      }),
    );
    const queued = vi.fn<AutosaveTask>().mockResolvedValue(true);

    act(() => controller.saveNow(first));
    act(() => controller.saveNow(queued));
    act(() => root.unmount());
    rootMounted = false;

    await act(async () => {
      resolveFirst?.(true);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(first).toHaveBeenCalledOnce();
    expect(queued).not.toHaveBeenCalled();
  });

  it("remains usable after a Strict Mode effect replay", async () => {
    act(() => root.unmount());
    rootMounted = false;
    root = ReactDOM.createRoot(container);
    rootMounted = true;
    act(() => {
      root.render(
        <StrictMode>
          <Harness onRender={(value) => (controller = value)} />
        </StrictMode>,
      );
    });
    const task = vi.fn<AutosaveTask>().mockResolvedValue(true);

    act(() => controller.schedule(task));
    await advance(750);

    expect(task).toHaveBeenCalledOnce();
  });

  it("pauses pending work and resumes it immediately", async () => {
    const task = vi.fn<AutosaveTask>().mockResolvedValue(true);
    act(() => controller.schedule(task));
    act(() => controller.pause());
    await advance(1000);
    expect(task).not.toHaveBeenCalled();
    expect(controller.status).toBe("paused");

    await act(async () => {
      controller.resume();
      await Promise.resolve();
    });
    expect(task).toHaveBeenCalledOnce();
  });

  it("keeps only the latest task scheduled while paused", async () => {
    const first = vi.fn<AutosaveTask>().mockResolvedValue(true);
    const latest = vi.fn<AutosaveTask>().mockResolvedValue(true);

    act(() => controller.pause());
    act(() => controller.schedule(first));
    act(() => controller.schedule(latest));
    await advance(1000);
    expect(first).not.toHaveBeenCalled();
    expect(latest).not.toHaveBeenCalled();

    await act(async () => {
      controller.resume();
      await Promise.resolve();
    });

    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledOnce();
  });

  it("retains failed work and retries it on flush", async () => {
    const task = vi
      .fn<AutosaveTask>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await act(async () => {
      controller.saveNow(task);
      await Promise.resolve();
    });
    expect(controller.status).toBe("error");
    expect(controller.hasPending).toBe(true);

    await act(async () => {
      controller.flush();
      await Promise.resolve();
    });
    expect(task).toHaveBeenCalledTimes(2);
    expect(controller.status).toBe("success");
  });

  it("runs a newer flushed snapshot after the in-flight task fails", async () => {
    let resolveFirst: ((success: boolean) => void) | undefined;
    const first = vi.fn<AutosaveTask>().mockReturnValue(
      new Promise((resolve) => {
        resolveFirst = resolve;
      }),
    );
    const latest = vi.fn<AutosaveTask>().mockResolvedValue(true);

    act(() => controller.saveNow(first));
    act(() => controller.schedule(latest));
    act(() => controller.flush());

    await act(async () => {
      resolveFirst?.(false);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(first).toHaveBeenCalledOnce();
    expect(latest).toHaveBeenCalledOnce();
    expect(controller.status).toBe("success");
  });

  it("discards queued work without invalidating an in-flight retry", async () => {
    let resolveTask: ((success: boolean) => void) | undefined;
    const task = vi
      .fn<AutosaveTask>()
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveTask = resolve;
        }),
      )
      .mockResolvedValueOnce(true);
    const discarded = vi.fn<AutosaveTask>().mockResolvedValue(true);

    act(() => controller.saveNow(task));
    act(() => controller.schedule(discarded));
    act(() => controller.discardPending());

    await act(async () => {
      resolveTask?.(false);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(discarded).not.toHaveBeenCalled();
    expect(controller.hasPending).toBe(true);
    expect(controller.status).toBe("error");

    await act(async () => {
      controller.flush();
      await Promise.resolve();
    });
    expect(task).toHaveBeenCalledTimes(2);
    expect(controller.status).toBe("success");
  });
});
