import { logger } from "@/lib/logger";

export type JobStatus = "pending" | "complete" | "error";

const jobStore = new Map<string, JobStatus>();
const expirationTimers = new Map<string, ReturnType<typeof setTimeout>>();

const JOB_EXPIRATION_MS = 5 * 60 * 1000; // 5 minutes
const log = logger.withScope("Jobs");

export function setJobStatus(jobId: string, status: JobStatus) {
  jobStore.set(jobId, status);
  log.info(`Job ${jobId} status=${status}`);

  const existingTimer = expirationTimers.get(jobId);
  if (existingTimer) {
    clearTimeout(existingTimer);
    expirationTimers.delete(jobId);
  }
  if (status === "pending") {
    return;
  }

  const timer = setTimeout(() => {
    jobStore.delete(jobId);
    expirationTimers.delete(jobId);
    log.debug(`Job ${jobId} expired (removed from store)`);
  }, JOB_EXPIRATION_MS);
  expirationTimers.set(jobId, timer);
}

export function getJobStatus(jobId: string): JobStatus | undefined {
  return jobStore.get(jobId);
}
