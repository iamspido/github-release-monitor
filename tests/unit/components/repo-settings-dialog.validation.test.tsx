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
  renderDialog,
  setInputValue,
  updateSettingsMock,
} from "./repo-settings-dialog.test-harness";

describe("RepoSettingsDialog validation and persistence", () => {
  it("shows the display section first and autosaves the display name", async () => {
    const onDisplayNameChange = vi.fn();
    renderDialog({ onDisplayNameChange });
    await flushEffects();

    const sectionHeadings = Array.from(container.querySelectorAll("h4"));
    expect(sectionHeadings[0]?.textContent).toBe("Display");

    const input = container.querySelector<HTMLInputElement>(
      'input[maxlength="100"]',
    );
    expect(input).not.toBeNull();
    expect(input?.placeholder).toBe("repo");

    await act(async () => {
      if (input) setInputValue(input, "Production Monitor");
    });
    await flushEffects();
    await advanceAutosaveDelay();

    await expectEventually(() => {
      expect(updateSettingsMock).toHaveBeenCalledWith(
        "owner/repo",
        expect.objectContaining({ displayName: "Production Monitor" }),
      );
    });
    expect(onDisplayNameChange).not.toHaveBeenCalled();

    renderDialog({ isOpen: false, onDisplayNameChange });
    await flushEffects();
    expect(onDisplayNameChange).toHaveBeenCalledWith("Production Monitor");
  });

  it("sends a serializable empty value when clearing the display name", async () => {
    renderDialog({
      currentRepoSettings: {
        ...emptyRepoSettings,
        displayName: "Production Monitor",
      },
    });
    await flushEffects();

    const input = container.querySelector<HTMLInputElement>(
      'input[maxlength="100"]',
    );
    expect(input).not.toBeNull();
    expect(input?.value).toBe("Production Monitor");

    await act(async () => {
      if (input) setInputValue(input, "");
    });
    await flushEffects();
    await advanceAutosaveDelay();

    await expectEventually(() => {
      expect(updateSettingsMock).toHaveBeenCalledWith(
        "owner/repo",
        expect.objectContaining({ displayName: "" }),
      );
    });
  });

  it("autosaves pinning and publishes it after the dialog closes", async () => {
    const onPinnedChange = vi.fn();
    renderDialog({ onPinnedChange });
    await flushEffects();

    const pinLabel = Array.from(container.querySelectorAll("label")).find(
      (label) => label.textContent === "Pin to top",
    );
    const checkbox = pinLabel?.htmlFor
      ? document.getElementById(pinLabel.htmlFor)
      : null;
    expect(checkbox?.getAttribute("role")).toBe("checkbox");

    await act(async () => {
      (checkbox as HTMLButtonElement | null)?.click();
    });
    await flushEffects();

    await expectEventually(() => {
      expect(updateSettingsMock).toHaveBeenCalledWith(
        "owner/repo",
        expect.objectContaining({ isPinned: true }),
      );
    });
    expect(onPinnedChange).not.toHaveBeenCalled();

    renderDialog({ isOpen: false, onPinnedChange });
    await flushEffects();
    expect(onPinnedChange).toHaveBeenCalledWith(true);
  });

  it("flushes a valid text change when the dialog closes", async () => {
    const setIsOpen = vi.fn();
    renderDialog({ setIsOpen });
    const input = await getIncludeInput();
    await act(async () => {
      setInputValue(input, "^v$");
    });
    await flushEffects();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="close-repository-settings"]',
        )
        ?.click();
      await Promise.resolve();
    });

    expect(setIsOpen).toHaveBeenCalledWith(false);
    expect(updateSettingsMock).toHaveBeenCalledWith(
      "owner/repo",
      expect.objectContaining({ includeRegex: "^v$" }),
    );
  });

  it("keeps the dialog open when unsaved settings are invalid", async () => {
    const setIsOpen = vi.fn();
    renderDialog({ setIsOpen });
    const input = await getIncludeInput();
    await act(async () => {
      setInputValue(input, "(");
    });
    await flushEffects();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="close-repository-settings"]',
        )
        ?.click();
      await vi.advanceTimersByTimeAsync(20);
    });

    expect(setIsOpen).not.toHaveBeenCalled();
    expect(updateSettingsMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain(
      "Fix invalid settings before closing",
    );
    expect(document.activeElement).toBe(input);
  });

  it("clears the close warning after restoring a valid saved value", async () => {
    const setIsOpen = vi.fn();
    renderDialog({ setIsOpen });
    const input = await getIncludeInput();
    await act(async () => {
      setInputValue(input, "(");
    });
    await flushEffects();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="close-repository-settings"]',
        )
        ?.click();
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(container.textContent).toContain(
      "Fix invalid settings before closing",
    );

    await act(async () => {
      setInputValue(input, "");
    });
    await flushEffects();

    expect(container.textContent).not.toContain(
      "Fix invalid settings before closing",
    );
  });

  it("blocks closing and focuses an invalid display name", async () => {
    const setIsOpen = vi.fn();
    renderDialog({ setIsOpen });
    const displayNameInput = container.querySelector<HTMLInputElement>(
      'input[maxlength="100"]',
    );
    expect(displayNameInput).not.toBeNull();

    await act(async () => {
      if (displayNameInput) setInputValue(displayNameInput, "bad\u0007name");
    });
    await flushEffects();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="close-repository-settings"]',
        )
        ?.click();
      await vi.advanceTimersByTimeAsync(20);
    });

    expect(setIsOpen).not.toHaveBeenCalled();
    expect(updateSettingsMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Enter a valid display name");
    expect(document.activeElement).toBe(displayNameInput);
  });

  it("commits a pending tag when the dialog closes", async () => {
    const setIsOpen = vi.fn();
    renderDialog({ setIsOpen });
    const tagInput = container.querySelector<HTMLInputElement>(
      'input[role="combobox"]',
    );
    expect(tagInput).not.toBeNull();

    await act(async () => {
      if (tagInput) setInputValue(tagInput, "critical");
    });
    await flushEffects();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="close-repository-settings"]',
        )
        ?.click();
      await Promise.resolve();
    });

    expect(setIsOpen).toHaveBeenCalledWith(false);
    expect(updateSettingsMock).toHaveBeenCalledWith(
      "owner/repo",
      expect.objectContaining({ tags: ["critical"] }),
    );
  });

  it("blocks closing and focuses an invalid pending tag", async () => {
    const setIsOpen = vi.fn();
    renderDialog({ setIsOpen });
    const tagInput = container.querySelector<HTMLInputElement>(
      'input[role="combobox"]',
    );
    expect(tagInput).not.toBeNull();

    await act(async () => {
      if (tagInput) setInputValue(tagInput, "x".repeat(41));
    });
    await flushEffects();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="close-repository-settings"]',
        )
        ?.click();
      await vi.advanceTimersByTimeAsync(20);
    });

    expect(setIsOpen).not.toHaveBeenCalled();
    expect(updateSettingsMock).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(tagInput);
  });

  it("blocks closing when a rejected comma-separated tag leaves an empty input", async () => {
    const setIsOpen = vi.fn();
    renderDialog({ setIsOpen });
    const tagInput = container.querySelector<HTMLInputElement>(
      'input[role="combobox"]',
    );
    expect(tagInput).not.toBeNull();

    await act(async () => {
      if (tagInput) setInputValue(tagInput, `${"x".repeat(41)},`);
    });
    await flushEffects();
    expect(tagInput?.value).toBe("");

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="close-repository-settings"]',
        )
        ?.click();
      await vi.advanceTimersByTimeAsync(20);
    });

    expect(setIsOpen).not.toHaveBeenCalled();
    expect(updateSettingsMock).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(tagInput);
  });

  it("blocks closing when an active interval field is empty", async () => {
    const setIsOpen = vi.fn();
    renderDialog({
      setIsOpen,
      currentRepoSettings: {
        ...emptyRepoSettings,
        refreshInterval: 60,
      },
    });
    const minuteLabel = Array.from(container.querySelectorAll("label")).find(
      (label) =>
        label.textContent === "SettingsForm.refresh_interval_minutes_label",
    );
    const minuteInput = minuteLabel?.htmlFor
      ? (document.getElementById(
          minuteLabel.htmlFor,
        ) as HTMLInputElement | null)
      : null;
    expect(minuteInput).not.toBeNull();

    await act(async () => {
      if (minuteInput) setInputValue(minuteInput, "");
    });
    await flushEffects();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="close-repository-settings"]',
        )
        ?.click();
      await vi.advanceTimersByTimeAsync(20);
    });

    expect(setIsOpen).not.toHaveBeenCalled();
    expect(updateSettingsMock).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(minuteInput);
  });

  it("requeues a failed snapshot after a temporary validation error", async () => {
    const setIsOpen = vi.fn();
    updateSettingsMock
      .mockResolvedValueOnce({ success: false, error: "save failed" })
      .mockResolvedValueOnce({ success: true });
    renderDialog({ setIsOpen });
    const input = await getIncludeInput();

    await act(async () => {
      setInputValue(input, "feature");
    });
    await flushEffects();
    await advanceAutosaveDelay();
    expect(updateSettingsMock).toHaveBeenCalledOnce();

    await act(async () => {
      setInputValue(input, "(");
    });
    await flushEffects();
    await act(async () => {
      setInputValue(input, "feature");
    });
    await flushEffects();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="close-repository-settings"]',
        )
        ?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(setIsOpen).toHaveBeenCalledWith(false);
    expect(updateSettingsMock).toHaveBeenCalledTimes(2);
    expect(updateSettingsMock).toHaveBeenLastCalledWith(
      "owner/repo",
      expect.objectContaining({ includeRegex: "feature" }),
    );
  });

  it("retries a failed in-flight snapshot after an invalid draft is corrected", async () => {
    let resolveSave:
      | ((value: { success: false; error: string }) => void)
      | undefined;
    updateSettingsMock
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
      )
      .mockResolvedValueOnce({ success: true });
    renderDialog();
    const input = await getIncludeInput();

    await act(async () => {
      setInputValue(input, "feature");
    });
    await flushEffects();
    await advanceAutosaveDelay();
    expect(updateSettingsMock).toHaveBeenCalledOnce();

    await act(async () => {
      setInputValue(input, "(");
    });
    await flushEffects();
    await act(async () => {
      resolveSave?.({ success: false, error: "save failed" });
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      setInputValue(input, "feature");
    });
    await flushEffects();
    await advanceAutosaveDelay(749);
    expect(updateSettingsMock).toHaveBeenCalledOnce();
    await advanceAutosaveDelay(1);
    expect(updateSettingsMock).toHaveBeenCalledTimes(2);
  });

  it("does not make the next text edit immediate after a no-op reset", async () => {
    renderDialog();
    await flushEffects();
    const automationHeading = Array.from(container.querySelectorAll("h4")).find(
      (heading) => heading.textContent === "Automation",
    );
    const automationSection = automationHeading?.parentElement?.parentElement;
    const resetButton =
      automationSection?.querySelector<HTMLButtonElement>("button");
    expect(resetButton).not.toBeNull();

    await act(async () => {
      resetButton?.click();
    });
    await flushEffects();
    expect(updateSettingsMock).not.toHaveBeenCalled();

    const displayNameInput = container.querySelector<HTMLInputElement>(
      'input[maxlength="100"]',
    );
    await act(async () => {
      if (displayNameInput) setInputValue(displayNameInput, "Delayed name");
    });
    await flushEffects();
    expect(updateSettingsMock).not.toHaveBeenCalled();
    await advanceAutosaveDelay();
    expect(updateSettingsMock).toHaveBeenCalledOnce();
  });
});
