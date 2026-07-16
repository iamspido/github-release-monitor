import { describe, expect, it } from "vitest";
import {
  trackBackgroundTask,
  waitForBackgroundTasks,
} from "@/lib/runtime/background-tasks";

describe("background tasks", () => {
  it("waits for rejected tasks without creating another rejected promise", async () => {
    const error = new Error("background task failed");
    const task = Promise.reject(error);

    trackBackgroundTask(task);

    await expect(task).rejects.toBe(error);
    await expect(waitForBackgroundTasks()).resolves.toBeUndefined();
  });
});
