// @vitest-environment jsdom
import { act } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useJobPolling } from "@/hooks/use-job-polling";

const { getJobStatusActionMock, reloadIfServerActionStaleMock } = vi.hoisted(
  () => ({
    getJobStatusActionMock: vi.fn(),
    reloadIfServerActionStaleMock: vi.fn(),
  }),
);

vi.mock("@/app/actions", () => ({
  getJobStatusAction: getJobStatusActionMock,
}));

vi.mock("@/lib/server-action-error", () => ({
  reloadIfServerActionStale: reloadIfServerActionStaleMock,
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function TestHarness({
  jobId,
  onComplete,
  onError,
  onTimeout,
  onDone,
  intervalMs = 100,
  timeoutMs = 500,
}: Parameters<typeof useJobPolling>[0]) {
  useJobPolling({
    jobId,
    onComplete,
    onError,
    onTimeout,
    onDone,
    intervalMs,
    timeoutMs,
  });
  return null;
}

describe("useJobPolling", () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  let onComplete: ReturnType<typeof vi.fn<() => void>>;
  let onError: ReturnType<typeof vi.fn<() => void>>;
  let onTimeout: ReturnType<typeof vi.fn<() => void>>;
  let onDone: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    vi.useFakeTimers();
    getJobStatusActionMock.mockReset();
    reloadIfServerActionStaleMock.mockReset();
    onComplete = vi.fn<() => void>();
    onError = vi.fn<() => void>();
    onTimeout = vi.fn<() => void>();
    onDone = vi.fn<() => void>();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
  });

  function render(jobId: string | undefined) {
    act(() => {
      root.render(
        <TestHarness
          jobId={jobId}
          onComplete={onComplete}
          onError={onError}
          onTimeout={onTimeout}
          onDone={onDone}
        />,
      );
    });
  }

  async function advance(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  it("does not poll without a job id", async () => {
    render(undefined);

    await advance(500);

    expect(getJobStatusActionMock).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("calls complete and done when the job completes", async () => {
    getJobStatusActionMock.mockResolvedValueOnce({ status: "complete" });
    render("job-1");

    await advance(100);
    await advance(300);

    expect(getJobStatusActionMock).toHaveBeenCalledTimes(1);
    expect(getJobStatusActionMock).toHaveBeenCalledWith("job-1");
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("calls error and done when the job returns an error status", async () => {
    getJobStatusActionMock.mockResolvedValueOnce({ status: "error" });
    render("job-1");

    await advance(100);

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("keeps polling pending jobs until timeout", async () => {
    getJobStatusActionMock.mockResolvedValue({ status: "pending" });
    render("job-1");

    await advance(600);

    expect(getJobStatusActionMock).toHaveBeenCalledTimes(5);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onComplete).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("does not call error callbacks when stale server action reload handling takes over", async () => {
    const error = new Error("Failed to find Server Action");
    getJobStatusActionMock.mockRejectedValueOnce(error);
    reloadIfServerActionStaleMock.mockReturnValueOnce(true);
    render("job-1");

    await advance(100);

    expect(reloadIfServerActionStaleMock).toHaveBeenCalledWith(error);
    expect(onError).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("calls error and done for non-stale polling failures", async () => {
    const error = new Error("network");
    getJobStatusActionMock.mockRejectedValueOnce(error);
    reloadIfServerActionStaleMock.mockReturnValueOnce(false);
    render("job-1");

    await advance(100);

    expect(reloadIfServerActionStaleMock).toHaveBeenCalledWith(error);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
