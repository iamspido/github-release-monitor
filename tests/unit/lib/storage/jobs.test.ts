import { getJobStatus, type JobStatus, setJobStatus } from "@/lib/storage/jobs";

describe("storage/jobs", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stores and retrieves job status, then expires", () => {
    const id = "job-123";
    const status: JobStatus = "pending";
    setJobStatus(id, status);

    expect(getJobStatus(id)).toBe("pending");

    // Advance time by just under 5 minutes
    vi.advanceTimersByTime(5 * 60 * 1000 - 1);
    expect(getJobStatus(id)).toBe("pending");

    // Advance past expiration
    vi.advanceTimersByTime(2);
    expect(getJobStatus(id)).toBeUndefined();
  });
});
