// @vitest-environment jsdom
import { act } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOptimisticSettingsPatch } from "@/hooks/use-optimistic-settings-patch";
import type { ReleaseSortOrder } from "@/types";

const updateSettingsPatchActionMock = vi.fn();
const toastMock = vi.fn();
const reloadIfServerActionStaleMock = vi.fn();

vi.mock("@/app/settings/actions", () => ({
  updateSettingsPatchAction: (...args: unknown[]) =>
    updateSettingsPatchActionMock(...args),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock("@/lib/server-action-error", () => ({
  reloadIfServerActionStale: (error: unknown) =>
    reloadIfServerActionStaleMock(error),
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type Controller = ReturnType<
  typeof useOptimisticSettingsPatch<ReleaseSortOrder>
>;

function Harness({
  canMutate = true,
  onRender,
  serverValue,
}: {
  canMutate?: boolean;
  onRender: (controller: Controller) => void;
  serverValue: ReleaseSortOrder;
}) {
  const controller = useOptimisticSettingsPatch({
    canMutate,
    createPatch: (value: ReleaseSortOrder) => ({ releaseSortOrder: value }),
    serverValue,
    unexpectedError: {
      title: "Unexpected title",
      description: "Unexpected description",
    },
  });
  onRender(controller);
  return <output>{controller.value}</output>;
}

describe("useOptimisticSettingsPatch", () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  let controller: Controller;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    updateSettingsPatchActionMock.mockReset();
    toastMock.mockReset();
    reloadIfServerActionStaleMock.mockReset();
    reloadIfServerActionStaleMock.mockReturnValue(false);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(
    serverValue: ReleaseSortOrder = "latest_first",
    canMutate = true,
  ) {
    act(() => {
      root.render(
        <Harness
          canMutate={canMutate}
          onRender={(value) => {
            controller = value;
          }}
          serverValue={serverValue}
        />,
      );
    });
  }

  async function settle() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("updates locally without saving when mutation is disabled", () => {
    render("latest_first", false);

    act(() => controller.update("repo_az"));

    expect(controller.value).toBe("repo_az");
    expect(updateSettingsPatchActionMock).not.toHaveBeenCalled();
  });

  it("keeps an optimistic value after a successful save", async () => {
    updateSettingsPatchActionMock.mockResolvedValue({
      success: true,
      message: { title: "ok", description: "ok" },
    });
    render();

    act(() => controller.update("repo_az"));
    await settle();

    expect(updateSettingsPatchActionMock).toHaveBeenCalledWith({
      releaseSortOrder: "repo_az",
    });
    expect(controller.value).toBe("repo_az");
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("rolls back and shows the server error after a rejected save", async () => {
    updateSettingsPatchActionMock.mockResolvedValue({
      success: false,
      message: { title: "Save failed", description: "Invalid setting" },
    });
    render();

    act(() => controller.update("repo_az"));
    await settle();

    expect(controller.value).toBe("latest_first");
    expect(toastMock).toHaveBeenCalledWith({
      title: "Save failed",
      description: "Invalid setting",
      variant: "destructive",
    });
  });

  it("rolls back and shows the unexpected error after an exception", async () => {
    updateSettingsPatchActionMock.mockRejectedValue(new Error("network"));
    render();

    act(() => controller.update("repo_az"));
    await settle();

    expect(controller.value).toBe("latest_first");
    expect(toastMock).toHaveBeenCalledWith({
      title: "Unexpected title",
      description: "Unexpected description",
      variant: "destructive",
    });
  });

  it("does not roll back when a stale server action triggers a reload", async () => {
    const error = new Error("stale action");
    updateSettingsPatchActionMock.mockRejectedValue(error);
    reloadIfServerActionStaleMock.mockReturnValue(true);
    render();

    act(() => controller.update("repo_az"));
    await settle();

    expect(reloadIfServerActionStaleMock).toHaveBeenCalledWith(error);
    expect(controller.value).toBe("repo_az");
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("ignores an older failure after a newer update succeeds", async () => {
    let rejectFirst: ((error: unknown) => void) | undefined;
    updateSettingsPatchActionMock
      .mockReturnValueOnce(
        new Promise((_resolve, reject) => {
          rejectFirst = reject;
        }),
      )
      .mockResolvedValueOnce({
        success: true,
        message: { title: "ok", description: "ok" },
      });
    render();

    act(() => controller.update("repo_az"));
    act(() => controller.update("repo_za"));
    await settle();

    await act(async () => {
      rejectFirst?.(new Error("late failure"));
      await Promise.resolve();
    });

    expect(controller.value).toBe("repo_za");
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("uses a new server value as the latest revision", async () => {
    let rejectSave: ((error: unknown) => void) | undefined;
    updateSettingsPatchActionMock.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectSave = reject;
      }),
    );
    render();
    act(() => controller.update("repo_az"));

    render("repo_za");
    expect(controller.value).toBe("repo_za");

    await act(async () => {
      rejectSave?.(new Error("late failure"));
      await Promise.resolve();
    });

    expect(controller.value).toBe("repo_za");
    expect(toastMock).not.toHaveBeenCalled();
  });
});
