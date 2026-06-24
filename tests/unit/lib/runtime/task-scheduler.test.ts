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
});
