import { scheduleTask } from "@/lib/runtime/task-scheduler";

describe("runtime/task-scheduler", () => {
  it("executes tasks sequentially in order", async () => {
    const order: string[] = [];

    const taskA = scheduleTask("A", async () => {
      order.push("start-A");
      await new Promise((r) => setTimeout(r, 30));
      order.push("end-A");
      return "A";
    });

    const taskB = scheduleTask("B", async () => {
      order.push("start-B");
      // Shorter task, but should still start after A finished
      await new Promise((r) => setTimeout(r, 5));
      order.push("end-B");
      return "B";
    });

    const [a, b] = await Promise.all([taskA, taskB]);

    expect(a).toBe("A");
    expect(b).toBe("B");
    expect(order).toEqual(["start-A", "end-A", "start-B", "end-B"]);
  });

  it("continues running queued tasks after a task rejects", async () => {
    const order: string[] = [];
    const failure = new Error("boom");

    const taskA = scheduleTask("rejecting task", async () => {
      order.push("start-A");
      throw failure;
    });

    const taskB = scheduleTask("following task", async () => {
      order.push("start-B");
      return "B";
    });

    await expect(taskA).rejects.toThrow("boom");
    await expect(taskB).resolves.toBe("B");
    expect(order).toEqual(["start-A", "start-B"]);
  });

  it("shares its queue across separately loaded module instances", async () => {
    const firstScheduler = await import("@/lib/runtime/task-scheduler");
    vi.resetModules();
    const secondScheduler = await import("@/lib/runtime/task-scheduler");
    const order: string[] = [];
    let finishFirst: (() => void) | undefined;

    const firstTask = firstScheduler.scheduleTask(
      "first module instance",
      async () => {
        order.push("start-first");
        await new Promise<void>((resolve) => {
          finishFirst = resolve;
        });
        order.push("end-first");
      },
    );
    await vi.waitFor(() => expect(finishFirst).toBeTypeOf("function"));

    const secondTask = secondScheduler.scheduleTask(
      "second module instance",
      async () => {
        order.push("start-second");
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(order).toEqual(["start-first"]);
    finishFirst?.();
    await Promise.all([firstTask, secondTask]);
    expect(order).toEqual(["start-first", "end-first", "start-second"]);
  });
});
