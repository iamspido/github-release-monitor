export type JobStatus = 'pending' | 'complete' | 'error';

const jobStore = new Map<string, JobStatus>();

const JOB_EXPIRATION_MS = 5 * 60 * 1000; // 5 minutes
import { logger } from '@/lib/logger';
const log = logger.withScope('Jobs');

export function setJobStatus(jobId: string, status: JobStatus) {
  jobStore.set(jobId, status);
  log.info(`Job ${jobId} status=${status}`);
  // Clean up the job after a while to prevent memory leaks
  setTimeout(() => {
    jobStore.delete(jobId);
    log.debug(`Job ${jobId} expired (removed from store)`);
  }, JOB_EXPIRATION_MS);
}

export function getJobStatus(jobId: string): JobStatus | undefined {
  return jobStore.get(jobId);
}
