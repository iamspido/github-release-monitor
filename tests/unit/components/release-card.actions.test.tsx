// @vitest-environment jsdom
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  baseSettings,
  container,
  getButtonBySpanText,
  getElementByText,
  makeRelease,
  makeSecurityRelease,
  mockedActions,
  ReleaseCardComponent,
  render,
  setNetworkOnline,
  toastSpy,
  unmountReleaseCard,
} from "./release-card.test-harness";

describe("ReleaseCard actions", () => {
  it("clears the reported settings state when an open card unmounts", async () => {
    const onSettingsOpenChange = vi.fn();

    render(
      <ReleaseCardComponent
        enrichedRelease={makeRelease()}
        settings={baseSettings}
        onSettingsOpenChange={onSettingsOpenChange}
      />,
    );

    const settingsButton = container?.querySelector<HTMLButtonElement>(
      'button[aria-label="Open repository settings"]',
    );
    await act(async () => {
      settingsButton?.click();
    });
    expect(onSettingsOpenChange).toHaveBeenCalledTimes(1);
    expect(onSettingsOpenChange).toHaveBeenLastCalledWith(true);

    await unmountReleaseCard();

    expect(onSettingsOpenChange).toHaveBeenCalledTimes(2);
    expect(onSettingsOpenChange).toHaveBeenLastCalledWith(false);
  });

  it("disables key actions when offline", async () => {
    setNetworkOnline(false);

    const enrichedRelease = {
      ...makeRelease(),
      isNew: false,
    };

    render(
      <ReleaseCardComponent
        enrichedRelease={enrichedRelease}
        settings={baseSettings}
      />,
    );

    const markAsNewButton = getButtonBySpanText("Mark as new");
    expect(markAsNewButton?.disabled).toBe(true);
    expect(markAsNewButton?.getAttribute("aria-disabled")).toBe("true");

    if (!container) throw new Error("Container not initialized");
    const removeButtons = Array.from(
      container.querySelectorAll("button"),
    ).filter((btn) => btn.textContent?.includes("Remove repository"));
    removeButtons.forEach((button) => {
      expect(button.disabled).toBe(true);
      expect(button.getAttribute("aria-disabled")).toBe("true");
    });
  });

  it("acknowledges a new release via the server action", async () => {
    setNetworkOnline(true);
    const actions = await mockedActions();
    actions.acknowledgeNewReleaseAction.mockResolvedValue({ success: true });

    const enrichedRelease = {
      ...makeRelease(),
      isNew: true,
    };

    render(
      <ReleaseCardComponent
        enrichedRelease={enrichedRelease}
        settings={baseSettings}
      />,
    );

    const acknowledgeButton = getButtonBySpanText("Acknowledge release");
    expect(acknowledgeButton).toBeTruthy();
    await act(async () => {
      acknowledgeButton?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(actions.acknowledgeNewReleaseAction).toHaveBeenCalledWith(
      "owner/repo",
    );
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it("highlights new security releases with a yellow badge and ring", async () => {
    const enrichedRelease = makeSecurityRelease(true);

    render(
      <ReleaseCardComponent
        enrichedRelease={enrichedRelease}
        settings={baseSettings}
      />,
    );

    const securityBadge = Array.from(
      container?.querySelectorAll("div") ?? [],
    ).find(
      (element) =>
        element.textContent === "Security" &&
        element.className.includes("border-yellow-500/70"),
    );
    expect(securityBadge).toBeTruthy();
    const card = Array.from(container?.querySelectorAll("div") ?? []).find(
      (element) => element.className.includes("ring-yellow-500/60"),
    );
    expect(card).toBeTruthy();
  });

  it("uses the configured preset color for security highlights", async () => {
    const enrichedRelease = makeSecurityRelease(true);

    render(
      <ReleaseCardComponent
        enrichedRelease={enrichedRelease}
        settings={{ ...baseSettings, securityHighlightColorPreset: "red" }}
      />,
    );

    const securityBadge = Array.from(
      container?.querySelectorAll("div") ?? [],
    ).find(
      (element) =>
        element.textContent === "Security" &&
        element.className.includes("border-red-500/70"),
    );
    expect(securityBadge).toBeTruthy();
    const card = Array.from(container?.querySelectorAll("div") ?? []).find(
      (element) => element.className.includes("ring-red-500/60"),
    );
    expect(card).toBeTruthy();
  });

  it("requires confirmation before acknowledging security releases when enabled", async () => {
    const actions = await mockedActions();
    actions.acknowledgeNewReleaseAction.mockResolvedValue({ success: true });
    const enrichedRelease = makeSecurityRelease(true);

    render(
      <ReleaseCardComponent
        enrichedRelease={enrichedRelease}
        settings={{ ...baseSettings, confirmSecurityAcknowledge: true }}
      />,
    );

    const acknowledgeButton = getButtonBySpanText("Acknowledge release");
    expect(acknowledgeButton).toBeTruthy();
    await act(async () => {
      acknowledgeButton?.click();
      await Promise.resolve();
    });
    expect(actions.acknowledgeNewReleaseAction).not.toHaveBeenCalled();

    const confirmButton = getElementByText("button", "Confirm security seen") as
      | HTMLButtonElement
      | undefined;
    expect(confirmButton).toBeTruthy();
    await act(async () => {
      confirmButton?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(actions.acknowledgeNewReleaseAction).toHaveBeenCalledWith(
      "owner/repo",
    );
  });

  it("does not show the security badge for seen security releases", async () => {
    const enrichedRelease = makeSecurityRelease(false);

    render(
      <ReleaseCardComponent
        enrichedRelease={enrichedRelease}
        settings={baseSettings}
      />,
    );

    const securityBadge = Array.from(
      container?.querySelectorAll("div") ?? [],
    ).find(
      (element) =>
        element.textContent === "Security" &&
        element.className.includes("border-yellow-500/70"),
    );
    const card = Array.from(container?.querySelectorAll("div") ?? []).find(
      (element) => element.className.includes("ring-yellow-500/60"),
    );
    expect(securityBadge).toBeUndefined();
    expect(card).toBeUndefined();
  });

  it("shows toast error when mark-as-new action fails", async () => {
    setNetworkOnline(true);
    const actions = await mockedActions();
    actions.markAsNewAction.mockResolvedValue({ success: false, error: "bad" });

    const enrichedRelease = {
      ...makeRelease(),
      isNew: false,
    };

    render(
      <ReleaseCardComponent
        enrichedRelease={enrichedRelease}
        settings={{ ...baseSettings, showMarkAsNew: true }}
      />,
    );

    const markButton = getButtonBySpanText("Mark as new");
    await act(async () => {
      markButton?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(actions.markAsNewAction).toHaveBeenCalledWith("owner/repo");
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Something went wrong",
        description: "bad",
        variant: "destructive",
      }),
    );
  });

  it("shows validation error when acknowledge action reports failure", async () => {
    setNetworkOnline(true);
    const actions = await mockedActions();
    actions.acknowledgeNewReleaseAction.mockResolvedValue({
      success: false,
      error: "nope",
    });

    const enrichedRelease = {
      ...makeRelease(),
      isNew: true,
    };

    render(
      <ReleaseCardComponent
        enrichedRelease={enrichedRelease}
        settings={baseSettings}
      />,
    );

    const acknowledgeButton = getButtonBySpanText("Acknowledge release");
    await act(async () => {
      acknowledgeButton?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(actions.acknowledgeNewReleaseAction).toHaveBeenCalledWith(
      "owner/repo",
    );
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Something went wrong",
        description: "nope",
        variant: "destructive",
      }),
    );
  });

  it("shows generic error toast when acknowledge action throws", async () => {
    setNetworkOnline(true);
    const actions = await mockedActions();
    actions.acknowledgeNewReleaseAction.mockRejectedValue(new Error("broken"));

    const enrichedRelease = {
      ...makeRelease(),
      isNew: true,
    };

    render(
      <ReleaseCardComponent
        enrichedRelease={enrichedRelease}
        settings={baseSettings}
      />,
    );

    const acknowledgeButton = getButtonBySpanText("Acknowledge release");
    await act(async () => {
      acknowledgeButton?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(actions.acknowledgeNewReleaseAction).toHaveBeenCalled();
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Something went wrong",
        description: "Failed to acknowledge",
        variant: "destructive",
      }),
    );
  });
});
