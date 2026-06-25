import {
  getSchedulerRuntimeSummary,
  schedulerRuntimeModel,
} from "@/lib/runtime/scheduler-capabilities";

describe("runtime/scheduler-capabilities", () => {
  it("documents that the current scheduler is process-local", () => {
    expect(schedulerRuntimeModel).toEqual({
      queueScope: "process",
      workerCoordination: "environment-flag",
      supportsCrossInstanceLocks: false,
    });
    expect(getSchedulerRuntimeSummary()).toContain("current Node.js process");
  });
});
