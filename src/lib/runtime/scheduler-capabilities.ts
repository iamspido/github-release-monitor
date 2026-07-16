export type SchedulerRuntimeModel = {
  queueScope: "process";
  workerCoordination: "environment-flag";
  supportsCrossInstanceLocks: boolean;
};

export const schedulerRuntimeModel: SchedulerRuntimeModel = {
  queueScope: "process",
  workerCoordination: "environment-flag",
  supportsCrossInstanceLocks: false,
};

export function getSchedulerRuntimeSummary(): string {
  return "Scheduler queue and background worker guards are scoped to the current Node.js process. Run a single app instance or replace this with persistent locks before horizontally scaling background work.";
}
