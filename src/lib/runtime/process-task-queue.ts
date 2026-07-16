type ProcessTaskQueue = {
  tail: Promise<void>;
};

type ProcessTaskQueueRegistry = Map<string, ProcessTaskQueue>;

const PROCESS_TASK_QUEUES_KEY = "__githubReleaseMonitorProcessTaskQueues";

type GlobalWithProcessTaskQueues = typeof globalThis & {
  [PROCESS_TASK_QUEUES_KEY]?: ProcessTaskQueueRegistry;
};

function getProcessTaskQueues(): ProcessTaskQueueRegistry {
  const processGlobal = globalThis as GlobalWithProcessTaskQueues;
  processGlobal[PROCESS_TASK_QUEUES_KEY] ??= new Map();
  return processGlobal[PROCESS_TASK_QUEUES_KEY];
}

export function scheduleProcessTask<T>(
  queueName: string,
  task: () => Promise<T>,
): Promise<T> {
  const queues = getProcessTaskQueues();
  let queue = queues.get(queueName);
  if (!queue) {
    queue = { tail: Promise.resolve() };
    queues.set(queueName, queue);
  }

  const taskPromise = queue.tail.then(task);
  queue.tail = taskPromise.then(
    () => undefined,
    () => undefined,
  );
  return taskPromise;
}
