import { logger } from '@/lib/logger';
// This promise is used to create a sequential task queue.
// All actions that modify the repository list should be wrapped in `scheduleTask`.
let currentUpdatePromise: Promise<any> = Promise.resolve();

/**
 * Schedules a task to be executed sequentially, preventing race conditions
 * when modifying shared resources like the repositories.json file.
 * @param taskName A descriptive name for the task, used for logging.
 * @param taskFunction The async function to execute.
 * @returns A promise that resolves with the result of the task function.
 */
export function scheduleTask<T>(taskName: string, taskFunction: () => Promise<T>): Promise<T> {
  const log = logger.withScope('Scheduler');
  log.info(`Queuing task: ${taskName}`);

  const taskPromise = currentUpdatePromise.then(async () => {
    log.info(`Starting task: ${taskName}`);
    try {
      return await taskFunction();
    } finally {
      log.info(`Finished task: ${taskName}`);
    }
  });

  currentUpdatePromise = taskPromise;
  return taskPromise;
}
