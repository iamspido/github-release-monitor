export type JobStatus = 'pending' | 'complete' | 'error';

const jobStore = new Map<string, JobStatus>();

const JOB_EXPIRATION_MS = 5 * 60 * 1000; // 5 minutes

export function setJobStatus(jobId: string, status: JobStatus) {
  jobStore.set(jobId, status);
  // Clean up the job after a while to prevent memory leaks
  setTimeout(() => {
    jobStore.delete(jobId);
  }, JOB_EXPIRATION_MS);
}

export function getJobStatus(jobId: string): JobStatus | undefined {
  return jobStore.get(jobId);
}
