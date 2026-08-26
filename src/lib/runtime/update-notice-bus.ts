import { getUpdateNotificationState } from "@/lib/runtime/app-update-notice";
import { subscribeToSystemStatus } from "@/lib/storage/system-status";
import type { UpdateNotificationState } from "@/types";

type UpdateNoticeListener = (notice: UpdateNotificationState) => void;

const listeners = new Map<UpdateNoticeListener, string | null>();
let pollInterval: ReturnType<typeof setInterval> | undefined;
let unsubscribeSystemStatus: (() => void) | undefined;
let publishInProgress: Promise<void> = Promise.resolve();
let hasPublishWork = false;
let publishRequested = false;

const CROSS_PROCESS_POLL_INTERVAL_MS = 5_000;

function stopBusIfIdle(): void {
  if (listeners.size > 0 || !pollInterval || hasPublishWork) return;

  clearInterval(pollInterval);
  pollInterval = undefined;
  unsubscribeSystemStatus?.();
  unsubscribeSystemStatus = undefined;
}

function getNoticeSignature(notice: UpdateNotificationState): string {
  return JSON.stringify([
    notice.latestVersion,
    notice.latestReleaseTitle,
    notice.latestSecurityVersion,
    notice.currentVersion,
    notice.hasUpdate,
    notice.isDismissed,
    notice.isSecurityUpdate,
    notice.shouldNotify,
  ]);
}

async function publishCurrentNotice(): Promise<void> {
  const notice = await getUpdateNotificationState();
  const signature = getNoticeSignature(notice);

  for (const [listener, previousSignature] of listeners) {
    if (previousSignature === signature) continue;
    listeners.set(listener, signature);
    try {
      listener(notice);
    } catch {
      listeners.delete(listener);
    }
  }
}

async function drainPublishQueue(): Promise<void> {
  do {
    publishRequested = false;
    try {
      await publishCurrentNotice();
    } catch {
      // A later status notification or the fallback poll will retry the read.
    }
  } while (publishRequested);
}

function queuePublish(): void {
  publishRequested = true;
  if (hasPublishWork) return;
  hasPublishWork = true;
  const nextPublish = publishInProgress.then(drainPublishQueue);

  nextPublish.then(() => {
    hasPublishWork = false;
    stopBusIfIdle();
  });
  publishInProgress = nextPublish;
}

function ensureBusStarted(): void {
  if (pollInterval) return;

  unsubscribeSystemStatus = subscribeToSystemStatus(queuePublish);
  pollInterval = setInterval(() => {
    // The status file is shared by all application instances. This fallback
    // detects writes made by another worker even though its listener set is
    // process-local.
    queuePublish();
  }, CROSS_PROCESS_POLL_INTERVAL_MS);
}

export function subscribeToUpdateNotice(
  listener: UpdateNoticeListener,
): () => void {
  ensureBusStarted();
  listeners.set(listener, null);

  queuePublish();

  return () => {
    listeners.delete(listener);
    stopBusIfIdle();
  };
}
