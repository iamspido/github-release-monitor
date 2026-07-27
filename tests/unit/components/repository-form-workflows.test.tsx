// @vitest-environment jsdom
import { act } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useRepositoryImportWorkflow,
  useRepositoryProviderWorkflow,
} from "@/components/repository-form-workflows";
import type { Repository } from "@/types";

const importRepositoriesActionMock = vi.fn();
const previewComposeImportActionMock = vi.fn();
const resolveRepoProvidersBatchActionMock = vi.fn();
const reloadIfServerActionStaleMock = vi.fn();
const toastMock = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/app/actions", () => ({
  importRepositoriesAction: (...args: unknown[]) =>
    importRepositoriesActionMock(...args),
  previewComposeImportAction: (...args: unknown[]) =>
    previewComposeImportActionMock(...args),
  resolveRepoProvidersBatchAction: (...args: unknown[]) =>
    resolveRepoProvidersBatchActionMock(...args),
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

type ProviderController = ReturnType<typeof useRepositoryProviderWorkflow>;
type ImportController = ReturnType<typeof useRepositoryImportWorkflow>;

function ProviderHarness({
  formAction,
  onRender,
  processed,
  selectedTags,
}: {
  formAction: (payload: FormData) => void;
  onRender: (controller: ProviderController) => void;
  processed: { current: boolean };
  selectedTags: readonly string[];
}) {
  onRender(useRepositoryProviderWorkflow(formAction, processed, selectedTags));
  return null;
}

function ImportHarness({
  currentRepositories,
  onImportSuccess,
  onJobStarted,
  onRender,
  selectedTags,
}: {
  currentRepositories: Repository[];
  onImportSuccess: () => void;
  onJobStarted: (jobId: string) => void;
  onRender: (controller: ImportController) => void;
  selectedTags: readonly string[];
}) {
  onRender(
    useRepositoryImportWorkflow({
      currentRepositories,
      onImportSuccess,
      onJobStarted,
      selectedTags,
    }),
  );
  return null;
}

describe("repository form workflows", () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  let fileContents: string;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    fileContents = "[]";
    importRepositoriesActionMock.mockReset();
    previewComposeImportActionMock.mockReset();
    resolveRepoProvidersBatchActionMock.mockReset();
    reloadIfServerActionStaleMock.mockReset();
    toastMock.mockReset();
    reloadIfServerActionStaleMock.mockReturnValue(false);

    class FakeFileReader {
      onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
      onerror: (() => void) | null = null;

      readAsText() {
        this.onload?.({
          target: { result: fileContents },
        } as ProgressEvent<FileReader>);
      }
    }
    vi.stubGlobal("FileReader", FakeFileReader);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function settle() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("resolves a unique shorthand and submits tags with the canonical URL", async () => {
    const formAction = vi.fn();
    const processed = { current: true };
    let controller!: ProviderController;
    resolveRepoProvidersBatchActionMock.mockResolvedValue({
      success: true,
      resolutions: [
        {
          input: "owner/repo",
          candidates: [
            {
              provider: "github",
              canonicalRepoUrl: "https://github.com/owner/repo",
            },
          ],
        },
      ],
    });
    act(() => {
      root.render(
        <ProviderHarness
          formAction={formAction}
          onRender={(value) => {
            controller = value;
          }}
          processed={processed}
          selectedTags={["production", "backend"]}
        />,
      );
    });

    act(() => controller.submit(["owner/repo", "https://codeberg.org/o/r"]));
    await settle();

    expect(resolveRepoProvidersBatchActionMock).toHaveBeenCalledWith([
      "owner/repo",
    ]);
    const payload = formAction.mock.calls[0][0] as FormData;
    expect(payload.get("urls")).toBe(
      "https://github.com/owner/repo\nhttps://codeberg.org/o/r",
    );
    expect(payload.getAll("tags")).toEqual(["production", "backend"]);
    expect(processed.current).toBe(false);
  });

  it("pauses for ambiguous providers and continues after selection", async () => {
    const formAction = vi.fn();
    let controller!: ProviderController;
    resolveRepoProvidersBatchActionMock.mockResolvedValue({
      success: true,
      resolutions: [
        {
          input: "owner/repo",
          candidates: [
            {
              provider: "codeberg",
              canonicalRepoUrl: "https://codeberg.org/owner/repo",
            },
            {
              provider: "github",
              canonicalRepoUrl: "https://github.com/owner/repo",
            },
          ],
        },
        {
          input: "second/repo",
          candidates: [
            {
              provider: "gitlab",
              canonicalRepoUrl: "https://gitlab.com/second/repo",
            },
          ],
        },
      ],
    });
    act(() => {
      root.render(
        <ProviderHarness
          formAction={formAction}
          onRender={(value) => {
            controller = value;
          }}
          processed={{ current: true }}
          selectedTags={[]}
        />,
      );
    });

    act(() => controller.submit(["owner/repo", "second/repo"]));
    await settle();

    expect(controller.dialogOpen).toBe(true);
    expect(controller.dialogRepo).toBe("owner/repo");
    expect(controller.dialogCandidates.map((entry) => entry.provider)).toEqual([
      "github",
      "codeberg",
    ]);
    expect(formAction).not.toHaveBeenCalled();

    act(() => controller.chooseProvider("https://codeberg.org/owner/repo"));
    await settle();

    const payload = formAction.mock.calls[0][0] as FormData;
    expect(payload.get("urls")).toBe(
      "https://codeberg.org/owner/repo\nhttps://gitlab.com/second/repo",
    );
    expect(controller.dialogOpen).toBe(false);
  });

  it("stops provider batches after a failed resolution response", async () => {
    const formAction = vi.fn();
    let controller!: ProviderController;
    const lines = Array.from(
      { length: 101 },
      (_, index) => `owner/repo-${index}`,
    );
    resolveRepoProvidersBatchActionMock.mockResolvedValue({
      success: false,
      resolutions: [],
    });
    act(() => {
      root.render(
        <ProviderHarness
          formAction={formAction}
          onRender={(value) => {
            controller = value;
          }}
          processed={{ current: true }}
          selectedTags={[]}
        />,
      );
    });

    act(() => controller.submit(lines));
    await settle();

    expect(resolveRepoProvidersBatchActionMock).toHaveBeenCalledTimes(1);
    const payload = formAction.mock.calls[0][0] as FormData;
    expect(String(payload.get("urls")).split("\n")).toEqual(lines);
  });

  it("handles provider resolution exceptions without submitting unresolved data", async () => {
    const formAction = vi.fn();
    let controller!: ProviderController;
    resolveRepoProvidersBatchActionMock.mockRejectedValue(
      new Error("server action failed"),
    );
    act(() => {
      root.render(
        <ProviderHarness
          formAction={formAction}
          onRender={(value) => {
            controller = value;
          }}
          processed={{ current: true }}
          selectedTags={[]}
        />,
      );
    });

    act(() => controller.submit(["owner/repo"]));
    await settle();

    expect(reloadIfServerActionStaleMock).toHaveBeenCalledOnce();
    expect(formAction).not.toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledWith({
      title: "toast_fail_title",
      description: "toast_generic_error",
      variant: "destructive",
    });
  });

  it("reloads instead of showing an error for a stale provider action", async () => {
    const formAction = vi.fn();
    let controller!: ProviderController;
    const staleError = new Error("stale server action");
    resolveRepoProvidersBatchActionMock.mockRejectedValue(staleError);
    reloadIfServerActionStaleMock.mockReturnValueOnce(true);
    act(() => {
      root.render(
        <ProviderHarness
          formAction={formAction}
          onRender={(value) => {
            controller = value;
          }}
          processed={{ current: true }}
          selectedTags={[]}
        />,
      );
    });

    act(() => controller.submit(["owner/repo"]));
    await settle();

    expect(reloadIfServerActionStaleMock).toHaveBeenCalledWith(staleError);
    expect(formAction).not.toHaveBeenCalled();
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("previews a JSON import and completes it with tags and job callbacks", async () => {
    const imported = [
      {
        id: "github:owner/repo",
        url: "https://github.com/owner/repo",
      },
    ];
    fileContents = JSON.stringify(imported);
    importRepositoriesActionMock.mockResolvedValue({
      success: true,
      message: "Imported",
      jobId: "job-1",
    });
    const onImportSuccess = vi.fn();
    const onJobStarted = vi.fn();
    let controller!: ImportController;
    act(() => {
      root.render(
        <ImportHarness
          currentRepositories={[]}
          onImportSuccess={onImportSuccess}
          onJobStarted={onJobStarted}
          onRender={(value) => {
            controller = value;
          }}
          selectedTags={["production"]}
        />,
      );
    });
    const file = new File([fileContents], "repositories.json", {
      type: "application/json",
    });

    await act(async () => {
      await controller.handleFileChange({
        target: { files: [file] },
      } as unknown as React.ChangeEvent<HTMLInputElement>);
    });

    expect(controller.dialogVisible).toBe(true);
    expect(controller.repositories).toEqual(imported);
    expect(controller.stats).toEqual({
      newCount: 1,
      existingCount: 0,
      skippedImages: undefined,
    });

    act(() => controller.confirmImport());
    await settle();

    expect(importRepositoriesActionMock).toHaveBeenCalledWith(imported, [
      "production",
    ]);
    expect(onImportSuccess).toHaveBeenCalledOnce();
    expect(onJobStarted).toHaveBeenCalledWith("job-1");
    expect(controller.dialogVisible).toBe(false);
    expect(controller.repositories).toBeNull();
  });

  it("previews compose imports and includes skipped image counts", async () => {
    fileContents = "services:\n  app:\n    image: example/app";
    previewComposeImportActionMock.mockResolvedValue({
      success: true,
      repositories: [
        {
          id: "github:owner/repo",
          url: "https://github.com/owner/repo",
        },
      ],
      skipped: {
        unsupported_registry: 2,
        missing_source: 1,
      },
    });
    let controller!: ImportController;
    act(() => {
      root.render(
        <ImportHarness
          currentRepositories={[
            {
              id: "github:owner/repo",
              url: "https://github.com/owner/repo",
            },
          ]}
          onImportSuccess={vi.fn()}
          onJobStarted={vi.fn()}
          onRender={(value) => {
            controller = value;
          }}
          selectedTags={[]}
        />,
      );
    });
    const file = new File([fileContents], "compose.yaml");

    await act(async () => {
      await controller.handleFileChange({
        target: { files: [file] },
      } as unknown as React.ChangeEvent<HTMLInputElement>);
      await Promise.resolve();
    });

    expect(previewComposeImportActionMock).toHaveBeenCalledWith(
      "compose.yaml",
      fileContents,
    );
    expect(controller.stats).toEqual({
      newCount: 0,
      existingCount: 1,
      skippedImages: 3,
    });
  });

  it("maps invalid JSON and failed imports to destructive toasts", async () => {
    fileContents = "{}";
    let controller!: ImportController;
    act(() => {
      root.render(
        <ImportHarness
          currentRepositories={[]}
          onImportSuccess={vi.fn()}
          onJobStarted={vi.fn()}
          onRender={(value) => {
            controller = value;
          }}
          selectedTags={[]}
        />,
      );
    });
    const file = new File([fileContents], "repositories.json");

    await act(async () => {
      await controller.handleFileChange({
        target: { files: [file] },
      } as unknown as React.ChangeEvent<HTMLInputElement>);
    });
    expect(toastMock).toHaveBeenCalledWith({
      title: "toast_import_error_title",
      description: "toast_import_error_invalid_format",
      variant: "destructive",
    });

    fileContents = JSON.stringify([
      {
        id: "github:owner/repo",
        url: "https://github.com/owner/repo",
      },
    ]);
    await act(async () => {
      await controller.handleFileChange({
        target: {
          files: [new File([fileContents], "repositories.json")],
        },
      } as unknown as React.ChangeEvent<HTMLInputElement>);
    });
    importRepositoriesActionMock.mockResolvedValue({
      success: false,
      message: "Import failed",
    });
    act(() => controller.confirmImport());
    await settle();

    expect(toastMock).toHaveBeenLastCalledWith({
      title: "toast_import_error_title",
      description: "Import failed",
      variant: "destructive",
    });
    expect(controller.dialogVisible).toBe(true);
  });
});
