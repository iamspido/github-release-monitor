const backgroundTasksGlobalKey = "__githubReleaseMonitorBackgroundTasks";

function getBackgroundTasks() {
  const globalScope = globalThis as typeof globalThis & {
    __githubReleaseMonitorBackgroundTasks?: Set<Promise<unknown>>;
  };
  globalScope[backgroundTasksGlobalKey] ??= new Set<Promise<unknown>>();
  return globalScope[backgroundTasksGlobalKey];
}

export function trackBackgroundTask<T>(task: Promise<T>) {
  const backgroundTasks = getBackgroundTasks();
  backgroundTasks.add(task);
  void task.finally(() => {
    backgroundTasks.delete(task);
  });
  return task;
}

export async function waitForBackgroundTasks() {
  const backgroundTasks = getBackgroundTasks();
  while (backgroundTasks.size > 0) {
    await Promise.allSettled(Array.from(backgroundTasks));
  }
}
