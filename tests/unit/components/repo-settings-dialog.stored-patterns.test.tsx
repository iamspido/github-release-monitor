// @vitest-environment jsdom
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Repository } from "@/types";
import {
  advanceAutosaveDelay,
  container,
  emptyRepoSettings,
  flushEffects,
  renderDialog,
  setInputValue,
  toastSpy,
  updateSettingsMock,
} from "./repo-settings-dialog.test-harness";

type PatternKey = "versionTagPattern" | "includeRegex" | "excludeRegex";

const storedPatterns: ReadonlyArray<{
  field: string;
  key: PatternKey;
  label: string;
  stored: string;
  refused: string;
  error: string;
}> = [
  {
    field: "version tag pattern",
    key: "versionTagPattern",
    label: "Version tag pattern (optional)",
    stored: "^v(?<version>\\d+(?:\\.\\d+)*)(?!-rc)",
    refused: "^v(?<version>\\d+)(?=$)",
    error: "Invalid version pattern",
  },
  {
    field: "include filter",
    key: "includeRegex",
    label: "Include regex",
    stored: "^v(?=\\d)",
    refused: "^v(?!0)",
    error: "Invalid regular expression.",
  },
  {
    field: "exclude filter",
    key: "excludeRegex",
    label: "Exclude regex",
    stored: "-(?!final)",
    refused: "-(?!rc)",
    error: "Invalid regular expression.",
  },
];

const DISPLAY_NAME_SELECTOR = 'input[maxlength="100"]';
const CLOSE_WARNING = "Fix invalid settings before closing";

function repositoryWith(
  patterns: Partial<Pick<Repository, PatternKey>>,
): typeof emptyRepoSettings {
  return {
    ...emptyRepoSettings,
    releaseSelectionStrategy: "highest_version",
    ...patterns,
  };
}

async function openDialog(
  currentRepoSettings: typeof emptyRepoSettings,
  setIsOpen: (isOpen: boolean) => void = () => {},
) {
  renderDialog({ isOpen: false, currentRepoSettings, setIsOpen });
  renderDialog({ isOpen: true, currentRepoSettings, setIsOpen });
  await flushEffects();
}

function fieldByLabel(label: string) {
  const labelElement = Array.from(container.querySelectorAll("label")).find(
    (candidate) => candidate.textContent === label,
  );
  const field = labelElement?.htmlFor
    ? document.getElementById(labelElement.htmlFor)
    : null;
  if (!(field instanceof HTMLInputElement)) {
    throw new Error(`${label} field not rendered`);
  }
  return field;
}

function displayNameInput() {
  const input = container.querySelector<HTMLInputElement>(
    DISPLAY_NAME_SELECTOR,
  );
  if (!input) throw new Error("display name field not rendered");
  return input;
}

async function typeInto(input: HTMLInputElement, value: string) {
  await act(async () => {
    setInputValue(input, value);
  });
  await flushEffects();
}

async function clickClose() {
  await act(async () => {
    container
      .querySelector<HTMLButtonElement>(
        '[data-testid="close-repository-settings"]',
      )
      ?.click();
    await vi.advanceTimersByTimeAsync(20);
  });
}

describe("RepoSettingsDialog with a stored pattern the engine refuses", () => {
  it.each(storedPatterns)(
    "autosaves another setting and keeps marking the stored $field",
    async ({ key, label, stored, error }) => {
      await openDialog(repositoryWith({ [key]: stored }));
      expect(fieldByLabel(label).value).toBe(stored);
      expect(container.textContent).toContain(error);

      await typeInto(displayNameInput(), "Production Monitor");
      await advanceAutosaveDelay();

      expect(updateSettingsMock).toHaveBeenCalledOnce();
      expect(updateSettingsMock).toHaveBeenCalledWith(
        "owner/repo",
        expect.objectContaining({
          displayName: "Production Monitor",
          [key]: stored,
        }),
      );
      expect(toastSpy).not.toHaveBeenCalled();
      expect(fieldByLabel(label).value).toBe(stored);
      expect(container.textContent).toContain(error);
    },
  );

  it.each(storedPatterns)(
    "closes while the stored $field is left unchanged",
    async ({ key, stored }) => {
      const setIsOpen = vi.fn();
      await openDialog(repositoryWith({ [key]: stored }), setIsOpen);

      await clickClose();

      expect(setIsOpen).toHaveBeenCalledWith(false);
      expect(container.textContent).not.toContain(CLOSE_WARNING);
      expect(updateSettingsMock).not.toHaveBeenCalled();
    },
  );

  it.each(storedPatterns)(
    "blocks the autosave and closing once the stored $field is changed to another refused pattern",
    async ({ key, label, stored, refused, error }) => {
      const setIsOpen = vi.fn();
      await openDialog(repositoryWith({ [key]: stored }), setIsOpen);
      const field = fieldByLabel(label);

      await typeInto(field, refused);
      await typeInto(displayNameInput(), "Production Monitor");
      await advanceAutosaveDelay();
      expect(updateSettingsMock).not.toHaveBeenCalled();
      expect(container.textContent).toContain(error);

      await clickClose();

      expect(setIsOpen).not.toHaveBeenCalled();
      expect(updateSettingsMock).not.toHaveBeenCalled();
      expect(container.textContent).toContain(CLOSE_WARNING);
      expect(document.activeElement).toBe(field);
    },
  );

  it("focuses the changed pattern, not the stored one, when closing is blocked", async () => {
    const setIsOpen = vi.fn();
    await openDialog(repositoryWith({ includeRegex: "^v(?=\\d)" }), setIsOpen);
    const versionField = fieldByLabel("Version tag pattern (optional)");

    await typeInto(versionField, "^v(?<version>\\d+)(?=$)");
    await clickClose();

    expect(setIsOpen).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(versionField);
  });

  it("reads a stored filter without surrounding whitespace, as the server compares it", async () => {
    await openDialog(repositoryWith({ excludeRegex: " -(?!final) " }));

    await typeInto(displayNameInput(), "Production Monitor");
    await advanceAutosaveDelay();

    expect(updateSettingsMock).toHaveBeenCalledOnce();
    expect(updateSettingsMock).toHaveBeenCalledWith(
      "owner/repo",
      expect.objectContaining({
        displayName: "Production Monitor",
        excludeRegex: "-(?!final)",
      }),
    );
    expect(container.textContent).toContain("Invalid regular expression.");
  });

  it("blocks the former pattern after a valid filter has replaced it", async () => {
    await openDialog(repositoryWith({ excludeRegex: "-(?!final)" }));
    const excludeField = fieldByLabel("Exclude regex");

    await typeInto(excludeField, "-rc");
    await advanceAutosaveDelay();
    expect(updateSettingsMock).toHaveBeenCalledOnce();
    expect(updateSettingsMock).toHaveBeenLastCalledWith(
      "owner/repo",
      expect.objectContaining({ excludeRegex: "-rc" }),
    );

    await typeInto(excludeField, "-(?!final)");
    await typeInto(displayNameInput(), "Production Monitor");
    await advanceAutosaveDelay();

    expect(updateSettingsMock).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Invalid regular expression.");
  });
});
