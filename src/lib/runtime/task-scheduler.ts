import { logger } from "@/lib/logger";
import { scheduleProcessTask } from "@/lib/runtime/process-task-queue";
import { getSchedulerRuntimeSummary } from "@/lib/runtime/scheduler-capabilities";

let runtimeModelLogged = false;

const SHARED_STATE_QUEUE = "shared-json-state";

function logRuntimeModelOnce() {
  if (runtimeModelLogged) return;
  runtimeModelLogged = true;
  logger.withScope("Scheduler").info(getSchedulerRuntimeSummary());
}

/**
 * Schedules a task to be executed sequentially, preventing race conditions
 * when modifying shared resources like the repositories.json file.
 * @param taskName A descriptive name for the task, used for logging.
 * @param taskFunction The async function to execute.
 * @returns A promise that resolves with the result of the task function.
 */
export function scheduleTask<T>(
  taskName: string,
  taskFunction: () => Promise<T>,
): Promise<T> {
  logRuntimeModelOnce();
  const log = logger.withScope("Scheduler");
  log.info(`Queuing task: ${taskName}`);

  return scheduleProcessTask(SHARED_STATE_QUEUE, async () => {
    log.info(`Starting task: ${taskName}`);
    try {
      return await taskFunction();
    } catch (error) {
      log.error(`Task failed: ${taskName}`, error);
      throw error;
    } finally {
      log.info(`Finished task: ${taskName}`);
    }
  });
}
