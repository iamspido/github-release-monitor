// @vitest-environment jsdom
import { act } from "react";
import { describe, expect, it } from "vitest";
import {
  advanceAutosaveDelay,
  expectEventually,
  flushEffects,
  getIncludeInput,
  renderDialog,
  setInputValue,
  toastSpy,
  updateSettingsMock,
} from "./repo-settings-dialog.test-harness";

describe("RepoSettingsDialog error handling", () => {
  it("blocks autosave when include regex becomes invalid", async () => {
    renderDialog();
    const input = await getIncludeInput();
    await act(async () => {
      setInputValue(input, "(");
    });
    await flushEffects();

    await advanceAutosaveDelay();

    await act(async () => {
      await expectEventually(() => {
        expect(document.body.textContent).toContain(
          "Invalid regular expression.",
        );
      });
    });
    expect(updateSettingsMock).not.toHaveBeenCalled();
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it("shows error toast when autosave returns failure", async () => {
    updateSettingsMock.mockResolvedValueOnce({ success: false, error: "nope" });

    renderDialog();
    const input = await getIncludeInput();
    await act(async () => {
      setInputValue(input, "feature");
    });
    await flushEffects();

    await advanceAutosaveDelay();

    await act(async () => {
      await expectEventually(() => {
        expect(toastSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "Save error",
            description: "nope",
            variant: "destructive",
          }),
        );
      });
    });
    expect(updateSettingsMock).toHaveBeenCalled();
  });

  it("shows error toast when autosave throws", async () => {
    updateSettingsMock.mockRejectedValueOnce(new Error("broken"));

    renderDialog();
    const input = await getIncludeInput();
    await act(async () => {
      setInputValue(input, "feature");
    });
    await flushEffects();

    await advanceAutosaveDelay();

    await act(async () => {
      await expectEventually(() => {
        expect(toastSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "Save error",
            description: "Error: broken",
            variant: "destructive",
          }),
        );
      });
    });
    expect(updateSettingsMock).toHaveBeenCalled();
  });
});
