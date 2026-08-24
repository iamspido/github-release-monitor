// @vitest-environment jsdom
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  advanceAutosaveDelay,
  container,
  createPointerEvent,
  emptyRepoSettings,
  expectEventually,
  flushEffects,
  renderDialog,
  setInputValue,
  setMockedLocale,
  updateSettingsMock,
} from "./repo-settings-dialog.test-harness";

describe("RepoSettingsDialog repository tags", () => {
  it("resets the release selection override with all repository settings", async () => {
    renderDialog({
      currentRepoSettings: {
        ...emptyRepoSettings,
        releaseSelectionStrategy: "highest_version",
        versionTagPattern: "^pkg/(?<version>\\d+\\.\\d+\\.\\d+)$",
      },
    });
    await flushEffects();

    const resetAllButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("Reset all"));
    expect(resetAllButton).toBeDefined();

    await act(async () => {
      resetAllButton?.click();
    });
    await flushEffects();

    const confirmButton = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("Confirm reset all"));
    expect(confirmButton).toBeDefined();

    await act(async () => {
      confirmButton?.click();
    });
    await flushEffects();
    await advanceAutosaveDelay();

    expect(updateSettingsMock).toHaveBeenCalledWith(
      "owner/repo",
      expect.objectContaining({
        releaseSelectionStrategy: undefined,
        versionTagPattern: undefined,
      }),
    );
  });

  it("reorders repository tags with controls and autosaves their order", async () => {
    renderDialog({ currentRepositoryTags: ["infra", "media", "retro"] });
    await flushEffects();

    const moveRightButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        'button[aria-label="Move tag right"]',
      ),
    );
    expect(moveRightButtons).toHaveLength(3);

    await act(async () => {
      moveRightButtons[0].click();
    });
    await advanceAutosaveDelay();

    await expectEventually(() => {
      expect(updateSettingsMock).toHaveBeenCalledWith(
        "owner/repo",
        expect.objectContaining({ tags: ["media", "infra", "retro"] }),
      );
    });
  });

  it("maps repository tag controls to the visible RTL direction", async () => {
    setMockedLocale("ar");
    renderDialog({ currentRepositoryTags: ["infra", "media", "retro"] });
    await flushEffects();

    const moveRightButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        'button[aria-label="Move tag right"]',
      ),
    );
    expect(moveRightButtons).toHaveLength(3);
    expect(moveRightButtons[0].disabled).toBe(true);

    await act(async () => {
      moveRightButtons[1].click();
    });
    await advanceAutosaveDelay();

    await expectEventually(() => {
      expect(updateSettingsMock).toHaveBeenCalledWith(
        "owner/repo",
        expect.objectContaining({ tags: ["media", "infra", "retro"] }),
      );
    });
  });

  it("publishes saved tag changes only after the dialog closes", async () => {
    const onRepositoryTagsChange = vi.fn();
    const props = {
      currentRepositoryTags: ["infra", "media"],
      onRepositoryTagsChange,
    };
    renderDialog(props);
    await flushEffects();

    const moveRightButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Move tag right"]',
    );
    expect(moveRightButton).not.toBeNull();

    await act(async () => {
      moveRightButton?.click();
    });
    await advanceAutosaveDelay();
    await expectEventually(() => {
      expect(updateSettingsMock).toHaveBeenCalledWith(
        "owner/repo",
        expect.objectContaining({ tags: ["media", "infra"] }),
      );
    });
    expect(onRepositoryTagsChange).not.toHaveBeenCalled();

    renderDialog({ ...props, isOpen: false });
    await flushEffects();

    expect(onRepositoryTagsChange).toHaveBeenCalledOnce();
    expect(onRepositoryTagsChange).toHaveBeenCalledWith(["media", "infra"]);
  });

  it("reorders repository tags with pointer dragging", async () => {
    renderDialog({ currentRepositoryTags: ["infra", "media", "retro"] });
    await flushEffects();

    const movableTags = Array.from(
      container.querySelectorAll<HTMLElement>(
        "li[data-repository-tag-index] > div",
      ),
    );
    expect(movableTags).toHaveLength(3);

    await act(async () => {
      movableTags[0].dispatchEvent(createPointerEvent("pointerdown"));
      movableTags[0].dispatchEvent(
        createPointerEvent("pointermove", { clientX: 10 }),
      );
    });
    expect(
      container.querySelector('[data-tag-drop-placeholder="true"]'),
    ).not.toBeNull();
    await act(async () => {
      movableTags[0].dispatchEvent(
        createPointerEvent("pointerup", { clientX: 10 }),
      );
    });
    await advanceAutosaveDelay();

    await expectEventually(() => {
      expect(updateSettingsMock).toHaveBeenCalledWith(
        "owner/repo",
        expect.objectContaining({ tags: ["media", "retro", "infra"] }),
      );
    });
  });

  it("cancels pointer dragging without reordering or autosaving tags", async () => {
    renderDialog({ currentRepositoryTags: ["infra", "media", "retro"] });
    await flushEffects();

    const movableTags = Array.from(
      container.querySelectorAll<HTMLElement>(
        "li[data-repository-tag-index] > div",
      ),
    );

    await act(async () => {
      movableTags[0].dispatchEvent(createPointerEvent("pointerdown"));
      movableTags[0].dispatchEvent(
        createPointerEvent("pointermove", { clientX: 10 }),
      );
      movableTags[0].dispatchEvent(
        createPointerEvent("pointercancel", { clientX: 10 }),
      );
    });

    expect(
      Array.from(
        container.querySelectorAll<HTMLElement>(
          "li[data-repository-tag-index]",
        ),
      ).map((item) => item.textContent),
    ).toEqual(["infra", "media", "retro"]);
    expect(document.body.querySelector('[data-tag-drag-preview="true"]')).toBe(
      null,
    );
    await advanceAutosaveDelay();
    expect(updateSettingsMock).not.toHaveBeenCalled();
  });

  it("cleans up pointer dragging when the dialog closes", async () => {
    const props = { currentRepositoryTags: ["infra", "media", "retro"] };
    renderDialog(props);
    await flushEffects();

    const movableTag = container.querySelector<HTMLElement>(
      "li[data-repository-tag-index] > div",
    );
    expect(movableTag).not.toBeNull();

    await act(async () => {
      movableTag?.dispatchEvent(createPointerEvent("pointerdown"));
      movableTag?.dispatchEvent(
        createPointerEvent("pointermove", { clientX: 10 }),
      );
    });
    expect(
      document.body.querySelector('[data-tag-drag-preview="true"]'),
    ).not.toBeNull();

    renderDialog({ ...props, isOpen: false });
    await flushEffects();

    expect(
      document.body.querySelector('[data-tag-drag-preview="true"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-tag-drop-placeholder="true"]'),
    ).toBeNull();
  });

  it("does not create a partial matching tag on blur", async () => {
    renderDialog({ availableRepositoryTags: ["media"] });
    await flushEffects();

    const tagInput = container.querySelector<HTMLInputElement>(
      'input[role="combobox"]',
    );
    expect(tagInput).not.toBeNull();

    await act(async () => {
      tagInput?.focus();
      if (tagInput) setInputValue(tagInput, "med");
      tagInput?.blur();
    });
    await advanceAutosaveDelay();

    expect(tagInput?.value).toBe("med");
    expect(updateSettingsMock).not.toHaveBeenCalled();
  });

  it("does not offer an already selected tag as a new tag", async () => {
    renderDialog({
      currentRepositoryTags: ["media"],
      availableRepositoryTags: ["media"],
    });
    await flushEffects();

    const tagInput = container.querySelector<HTMLInputElement>(
      'input[role="combobox"]',
    );
    await act(async () => {
      tagInput?.focus();
      if (tagInput) setInputValue(tagInput, "MEDIA");
    });

    expect(document.body.textContent).not.toContain("Add new tag");
  });

  it("searches and adds an existing tag from the integrated input", async () => {
    renderDialog({
      currentRepositoryTags: ["infra"],
      availableRepositoryTags: ["infra", "media", "retro"],
    });
    await flushEffects();

    const tagInput = container.querySelector<HTMLInputElement>(
      'input[role="combobox"]',
    );
    expect(tagInput).not.toBeNull();

    await act(async () => {
      tagInput?.focus();
      if (tagInput) setInputValue(tagInput, "med");
    });
    expect(document.body.textContent).toContain("media");
    expect(
      Array.from(document.body.querySelectorAll('[role="option"]')).some(
        (item) => item.textContent?.includes("retro"),
      ),
    ).toBe(false);

    await act(async () => {
      tagInput?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await flushEffects();
    expect(tagInput?.value).toBe("");
    await advanceAutosaveDelay();

    await expectEventually(() => {
      expect(updateSettingsMock).toHaveBeenCalledWith(
        "owner/repo",
        expect.objectContaining({ tags: ["infra", "media"] }),
      );
    });
  });

  it("creates the typed tag when the integrated search has no match", async () => {
    renderDialog({ availableRepositoryTags: ["infra", "media"] });
    await flushEffects();

    const tagInput = container.querySelector<HTMLInputElement>(
      'input[role="combobox"]',
    );
    expect(tagInput).not.toBeNull();

    await act(async () => {
      tagInput?.focus();
      if (tagInput) setInputValue(tagInput, "retro");
    });
    expect(document.body.textContent).toContain("Add new tag");

    await act(async () => {
      tagInput?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await advanceAutosaveDelay();

    await expectEventually(() => {
      expect(updateSettingsMock).toHaveBeenCalledWith(
        "owner/repo",
        expect.objectContaining({ tags: ["retro"] }),
      );
    });
  });

  it("does not remove tags when Backspace or Delete is pressed in an empty input", async () => {
    renderDialog({ currentRepositoryTags: ["infra", "media"] });
    await flushEffects();

    const tagInput = container.querySelector<HTMLInputElement>(
      'input[placeholder="RepoSettingsDialog.tags_placeholder"]',
    );
    expect(tagInput).not.toBeNull();

    await act(async () => {
      tagInput?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }),
      );
      tagInput?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Delete", bubbles: true }),
      );
    });
    await advanceAutosaveDelay();

    expect(updateSettingsMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain("infra");
    expect(container.textContent).toContain("media");
  });
});
