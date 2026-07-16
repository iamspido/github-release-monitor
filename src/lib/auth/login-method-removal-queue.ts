type LoginMethodRemovalQueueGlobal = typeof globalThis & {
  __githubReleaseMonitorLoginMethodRemovalQueues?: Map<string, Promise<void>>;
};

const queueGlobal = globalThis as LoginMethodRemovalQueueGlobal;
const userRemovalQueues =
  queueGlobal.__githubReleaseMonitorLoginMethodRemovalQueues ??
  new Map<string, Promise<void>>();
queueGlobal.__githubReleaseMonitorLoginMethodRemovalQueues = userRemovalQueues;

/**
 * Serializes login-method removals for one user without blocking unrelated
 * users or JSON-backed application state updates.
 */
export function scheduleLoginMethodRemoval<T>(
  userId: string,
  task: () => Promise<T>,
): Promise<T> {
  const queueKey = userId.trim();
  if (!queueKey) {
    return Promise.reject(new Error("A user id is required for removal."));
  }

  const previousTask = userRemovalQueues.get(queueKey) ?? Promise.resolve();
  const result = previousTask.then(task);
  const queueTail = result.then(
    () => undefined,
    () => undefined,
  );
  userRemovalQueues.set(queueKey, queueTail);

  void queueTail.then(() => {
    if (userRemovalQueues.get(queueKey) === queueTail) {
      userRemovalQueues.delete(queueKey);
    }
  });

  return result;
}
