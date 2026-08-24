// @vitest-environment jsdom
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  advanceAutosaveDelay,
  container,
  emptyRepoSettings,
  expectEventually,
  flushEffects,
  getIncludeInput,
  refreshRepositoryMock,
  renderDialog,
  setInputValue,
  setNetworkOnline,
  toastSpy,
  updateSettingsMock,
} from "./repo-settings-dialog.test-harness";

describe("RepoSettingsDialog autosave behaviour", () => {
  it("pauses autosave when offline without calling update action", async () => {
    setNetworkOnline(false);
    renderDialog();
    await flushEffects();
    expect(document.body.textContent).toContain(
      "Offline – this dialog is read-only. Changes will not be saved until you're back online.",
    );
    expect(updateSettingsMock).not.toHaveBeenCalled();
  });

  it("associates the release selection label with its trigger", async () => {
    renderDialog();
    await flushEffects();

    const label = Array.from(container.querySelectorAll("label")).find(
      (candidate) => candidate.textContent === "Release selection",
    );
    expect(label?.htmlFor).toBeTruthy();
    expect(
      document.getElementById(label?.htmlFor ?? "")?.getAttribute("role"),
    ).toBe("combobox");
  });

  it("autosaves a valid repository version tag pattern", async () => {
    renderDialog({
      currentRepoSettings: {
        ...emptyRepoSettings,
        releaseSelectionStrategy: "highest_version",
        versionTagPattern: "^pkg/(?<version>\\d+\\.\\d+\\.\\d+)$",
      },
    });
    await flushEffects();

    const label = Array.from(container.querySelectorAll("label")).find(
      (candidate) => candidate.textContent === "Version tag pattern (optional)",
    );
    const input = document.getElementById(
      label?.htmlFor ?? "",
    ) as HTMLInputElement | null;
    expect(input?.disabled).toBe(false);

    const pattern =
      "^docker/(?<version>\\d+\\.\\d+\\.\\d+)-r(?<revision>\\d+)$";
    await act(async () => {
      if (input) setInputValue(input, pattern);
    });
    await advanceAutosaveDelay();

    expect(updateSettingsMock).toHaveBeenCalledWith(
      "owner/repo",
      expect.objectContaining({ versionTagPattern: pattern }),
    );
  });

  it("blocks autosave when the version tag pattern has no version group", async () => {
    renderDialog({
      currentRepoSettings: {
        ...emptyRepoSettings,
        releaseSelectionStrategy: "highest_version",
      },
    });
    await flushEffects();

    const label = Array.from(container.querySelectorAll("label")).find(
      (candidate) => candidate.textContent === "Version tag pattern (optional)",
    );
    const input = document.getElementById(
      label?.htmlFor ?? "",
    ) as HTMLInputElement | null;

    await act(async () => {
      if (input) setInputValue(input, "^(\\d+\\.\\d+\\.\\d+)$");
    });
    await advanceAutosaveDelay();

    expect(container.textContent).toContain("Missing named version group");
    expect(updateSettingsMock).not.toHaveBeenCalled();
  });

  it("does not replace inherited prerelease subchannels when opened", async () => {
    const inheritedSettings = {
      ...emptyRepoSettings,
      preReleaseSubChannels: undefined,
    };

    renderDialog({
      isOpen: false,
      currentRepoSettings: inheritedSettings,
    });
    renderDialog({ currentRepoSettings: inheritedSettings });
    await flushEffects();
    await advanceAutosaveDelay();

    expect(updateSettingsMock).not.toHaveBeenCalled();
  });

  it("does not autosave a stale closed draft while hydrating updated props", async () => {
    renderDialog({ isOpen: false });
    await flushEffects();

    renderDialog({
      currentRepoSettings: {
        ...emptyRepoSettings,
        includeRegex: "from-parent",
      },
    });
    await flushEffects();
    await advanceAutosaveDelay();

    expect((await getIncludeInput()).value).toBe("from-parent");
    expect(updateSettingsMock).not.toHaveBeenCalled();
  });

  it("refreshes after a filter save that finishes after the dialog closes", async () => {
    let resolveSave: ((value: { success: true }) => void) | undefined;
    updateSettingsMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSave = resolve;
      }),
    );

    renderDialog();
    const input = await getIncludeInput();
    await act(async () => {
      setInputValue(input, "feature");
    });
    await flushEffects();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(750);
      await Promise.resolve();
    });
    expect(updateSettingsMock).toHaveBeenCalledOnce();

    renderDialog({ isOpen: false });
    await flushEffects();
    expect(refreshRepositoryMock).not.toHaveBeenCalled();

    await act(async () => {
      resolveSave?.({ success: true });
      await Promise.resolve();
      await Promise.resolve();
    });

    await expectEventually(() => {
      expect(refreshRepositoryMock).toHaveBeenCalledWith("owner/repo");
    });
  });

  it("preserves an in-flight draft when the dialog reopens", async () => {
    let resolveSave: ((value: { success: true }) => void) | undefined;
    updateSettingsMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSave = resolve;
      }),
    );

    renderDialog();
    const input = await getIncludeInput();
    await act(async () => {
      setInputValue(input, "discarded-filter");
    });
    await flushEffects();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(750);
      await Promise.resolve();
    });
    expect(updateSettingsMock).toHaveBeenCalledOnce();

    renderDialog({ isOpen: false });
    await flushEffects();
    renderDialog();
    await flushEffects();
    expect((await getIncludeInput()).value).toBe("discarded-filter");

    await act(async () => {
      resolveSave?.({ success: true });
      await Promise.resolve();
      await Promise.resolve();
    });
    await advanceAutosaveDelay();
    expect(updateSettingsMock).toHaveBeenCalledOnce();
  });

  it("keeps a close-flushed snapshot immediate when reopening during an in-flight save", async () => {
    let resolveFirstSave: ((value: { success: true }) => void) | undefined;
    updateSettingsMock
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirstSave = resolve;
        }),
      )
      .mockResolvedValueOnce({ success: true });
    const setIsOpen = vi.fn();

    renderDialog({ setIsOpen });
    const input = await getIncludeInput();
    await act(async () => {
      setInputValue(input, "first-filter");
    });
    await flushEffects();
    await advanceAutosaveDelay();
    expect(updateSettingsMock).toHaveBeenCalledOnce();

    await act(async () => {
      setInputValue(input, "latest-filter");
    });
    await flushEffects();
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="close-repository-settings"]',
        )
        ?.click();
    });
    expect(setIsOpen).toHaveBeenCalledWith(false);

    renderDialog({ isOpen: false, setIsOpen });
    await flushEffects();
    renderDialog({ setIsOpen });
    await flushEffects();

    await act(async () => {
      resolveFirstSave?.({ success: true });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(updateSettingsMock).toHaveBeenCalledTimes(2);
    expect(updateSettingsMock).toHaveBeenLastCalledWith(
      "owner/repo",
      expect.objectContaining({ includeRegex: "latest-filter" }),
    );
  });

  it("drops a waiting snapshot when the draft returns to the saved snapshot", async () => {
    let resolveFirstSave: ((value: { success: true }) => void) | undefined;
    updateSettingsMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFirstSave = resolve;
      }),
    );

    renderDialog();
    const input = await getIncludeInput();
    await act(async () => {
      setInputValue(input, "saved-filter");
    });
    await flushEffects();
    await advanceAutosaveDelay();
    expect(updateSettingsMock).toHaveBeenCalledOnce();

    await act(async () => {
      setInputValue(input, "stale-filter");
    });
    await flushEffects();
    await act(async () => {
      resolveFirstSave?.({ success: true });
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      setInputValue(input, "saved-filter");
    });
    await flushEffects();
    await advanceAutosaveDelay(1000);

    expect(updateSettingsMock).toHaveBeenCalledOnce();
  });

  it("shows success and commits settings when autosave succeeds", async () => {
    updateSettingsMock.mockResolvedValueOnce({ success: true });

    renderDialog();
    const input = await getIncludeInput();
    await act(async () => {
      setInputValue(input, "feature");
    });
    await flushEffects();

    await advanceAutosaveDelay();

    await act(async () => {
      await expectEventually(() => {
        expect(updateSettingsMock).toHaveBeenCalledWith(
          "owner/repo",
          expect.objectContaining({ includeRegex: "feature" }),
        );
      });
    });
    await act(async () => {
      await expectEventually(() => {
        expect(document.body.textContent).toContain("Saved");
      });
    });
    expect(toastSpy).not.toHaveBeenCalled();
  });
});
