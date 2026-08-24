// @vitest-environment jsdom
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import type { EnrichedRelease } from "@/types";
import {
  baseSettings,
  container,
  getElementByText,
  makeRelease,
  mockedActions,
  ReleaseCardComponent,
  render,
} from "./release-card.test-harness";

describe("ReleaseCard rendering", () => {
  it("ignores invalid persisted release timestamps", () => {
    const enrichedRelease = makeRelease();
    if (!enrichedRelease.release) {
      throw new Error("Base release missing release payload");
    }
    enrichedRelease.release = {
      ...enrichedRelease.release,
      created_at: "not-a-date",
      published_at: "also-not-a-date",
      fetched_at: "still-not-a-date",
    };

    expect(() =>
      render(
        <ReleaseCardComponent
          enrichedRelease={enrichedRelease}
          settings={baseSettings}
        />,
      ),
    ).not.toThrow();
    expect(container?.textContent).not.toContain("Released");
    expect(container?.textContent).not.toContain("Checked");
  });

  it("falls back to the creation time when the publication time is invalid", () => {
    const enrichedRelease = makeRelease();
    if (!enrichedRelease.release) {
      throw new Error("Base release missing release payload");
    }
    enrichedRelease.release = {
      ...enrichedRelease.release,
      published_at: "not-a-date",
    };

    render(
      <ReleaseCardComponent
        enrichedRelease={enrichedRelease}
        settings={baseSettings}
      />,
    );

    expect(container?.textContent).toContain("Released relative time");
  });

  it("renders a compact row and mounts release notes only when expanded", async () => {
    const actions = await mockedActions();
    render(
      <ReleaseCardComponent
        enrichedRelease={makeRelease()}
        settings={baseSettings}
        variant="compact"
      />,
    );

    expect(container?.querySelector("article")).not.toBeNull();
    expect(container?.querySelector('[data-testid="markdown"]')).toBeNull();

    const expandButton = container?.querySelector<HTMLButtonElement>(
      'button[aria-label="Expand release details for owner/repo"]',
    );
    expect(expandButton?.getAttribute("aria-expanded")).toBe("false");
    const controlledDetails = document.getElementById(
      expandButton?.getAttribute("aria-controls") ?? "",
    );
    expect(controlledDetails).not.toBeNull();
    expect(controlledDetails?.hidden).toBe(true);
    expect(expandButton?.className).toContain("hover:bg-foreground/5");
    expect(expandButton?.className).not.toContain("hover:bg-accent");
    expect(expandButton?.className).toContain("focus-visible:ring-inset");
    expect(expandButton?.className).toContain("focus-visible:ring-offset-0");
    const article = container?.querySelector("article");
    expect(article?.className).toContain("isolate");
    const headingId = article?.getAttribute("aria-labelledby");
    expect(headingId).toBeTruthy();
    expect(document.getElementById(headingId ?? "")?.tagName).toBe("H3");
    expect(
      container?.querySelector(
        'button[aria-label="Mark release for owner/repo as new"]',
      ),
    ).not.toBeNull();
    expect(
      container?.querySelector('button[aria-label="Remove owner/repo"]'),
    ).not.toBeNull();
    expect(
      container?.querySelector('a[aria-label="Open release for owner/repo"]'),
    ).not.toBeNull();
    const compactActionLabels = Array.from(
      container?.querySelectorAll<HTMLElement>(
        '[aria-label="Mark release for owner/repo as new"], [aria-label="Open settings for owner/repo"], [aria-label="Open release for owner/repo"], [aria-label="Remove owner/repo"]',
      ) ?? [],
    ).map((element) => element.getAttribute("aria-label"));
    expect(compactActionLabels).toEqual([
      "Mark release for owner/repo as new",
      "Open settings for owner/repo",
      "Open release for owner/repo",
      "Remove owner/repo",
    ]);

    const repositoryLink = container?.querySelector<HTMLAnchorElement>(
      'a[href="https://github.com/owner/repo"]',
    );
    repositoryLink?.addEventListener("click", (event) =>
      event.preventDefault(),
    );
    expect(repositoryLink?.className).toContain("w-fit");
    await act(async () => repositoryLink?.click());
    expect(expandButton?.getAttribute("aria-expanded")).toBe("false");

    const releaseLink = container?.querySelector<HTMLAnchorElement>(
      'a[href="https://github.com/owner/repo/releases/tag/v1.0.0"]:not([aria-label])',
    );
    releaseLink?.addEventListener("click", (event) => event.preventDefault());
    expect(releaseLink?.className).toContain("w-fit");
    await act(async () => releaseLink?.click());
    expect(expandButton?.getAttribute("aria-expanded")).toBe("false");

    const markAsNewButton = container?.querySelector<HTMLButtonElement>(
      'button[aria-label="Mark release for owner/repo as new"]',
    );
    await act(async () => {
      markAsNewButton?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(expandButton?.getAttribute("aria-expanded")).toBe("false");
    expect(actions.markAsNewAction).toHaveBeenCalledWith("owner/repo");

    await act(async () => expandButton?.click());

    const collapseButton = container?.querySelector<HTMLButtonElement>(
      'button[aria-label="Collapse release details for owner/repo"]',
    );
    expect(collapseButton?.getAttribute("aria-expanded")).toBe("true");
    expect(controlledDetails?.hidden).toBe(false);
    expect(container?.querySelector('[data-testid="markdown"]')).not.toBeNull();
    expect(container?.querySelector("article")?.className).toContain(
      "col-span-full",
    );
  });

  it("keeps the repository path linked while expanding compact error details", async () => {
    const enrichedRelease: EnrichedRelease = {
      repoId: "owner/repo",
      repoUrl: "https://github.com/owner/repo",
      error: { type: "repo_not_found" },
      repoSettings: { displayName: "Production Monitor" },
    };

    render(
      <ReleaseCardComponent
        enrichedRelease={enrichedRelease}
        settings={baseSettings}
        variant="compact"
      />,
    );

    const expandButton = container?.querySelector<HTMLButtonElement>(
      'button[aria-label="Expand release details for owner/repo"]',
    );
    const repositoryLinks = container?.querySelectorAll<HTMLAnchorElement>(
      'a[href="https://github.com/owner/repo"]',
    );
    expect(repositoryLinks?.length).toBe(2);
    repositoryLinks?.forEach((link) => {
      link.addEventListener("click", (event) => event.preventDefault());
    });
    await act(async () => repositoryLinks?.[1]?.click());
    expect(expandButton?.getAttribute("aria-expanded")).toBe("false");
    await act(async () => expandButton?.click());

    expect(container?.querySelector("article")?.className).toContain("isolate");
    expect(container?.textContent).toContain("Repository not found");
    expect(
      container?.querySelector('button[aria-label="Remove owner/repo"]'),
    ).not.toBeNull();
    expect(
      container?.querySelector('[aria-label="Overrides applied"]'),
    ).not.toBeNull();
  });

  it("limits the repository link hit area in a compact loading row", () => {
    const enrichedRelease: EnrichedRelease = {
      repoId: "owner/repo",
      repoUrl: "https://github.com/owner/repo",
    };

    render(
      <ReleaseCardComponent
        enrichedRelease={enrichedRelease}
        settings={baseSettings}
        variant="compact"
      />,
    );

    const repositoryLink = container?.querySelector<HTMLAnchorElement>(
      'a[href="https://github.com/owner/repo"]',
    );
    expect(repositoryLink?.className).toContain("w-fit");
    expect(repositoryLink?.className).toContain("max-w-full");
  });

  it("keeps repository state indicators available in compact desktop and mobile layouts", async () => {
    const enrichedRelease = makeRelease();
    enrichedRelease.repoSettings = {
      displayName: "Production Monitor",
      isPinned: true,
    };

    render(
      <ReleaseCardComponent
        enrichedRelease={enrichedRelease}
        settings={baseSettings}
        variant="compact"
      />,
    );

    const expandButton = container?.querySelector<HTMLButtonElement>(
      'button[aria-label="Expand release details for owner/repo"]',
    );
    await act(async () => expandButton?.click());

    const pinnedIndicators = container?.querySelectorAll(
      '[aria-label="Pinned to top"]',
    );
    const customIndicators = container?.querySelectorAll(
      '[aria-label="Overrides applied"]',
    );

    expect(pinnedIndicators?.length).toBe(2);
    expect(customIndicators?.length).toBe(2);
    expect(pinnedIndicators?.[0]?.parentElement?.className).toContain(
      "hidden sm:flex",
    );
    expect(pinnedIndicators?.[1]?.parentElement?.className).toContain(
      "flex sm:hidden",
    );
  });

  it("uses the custom display name as the release card heading", () => {
    const enrichedRelease = makeRelease();
    enrichedRelease.repoSettings = { displayName: "Production Monitor" };

    render(
      <ReleaseCardComponent
        enrichedRelease={enrichedRelease}
        settings={baseSettings}
      />,
    );

    expect(container?.querySelector("h3")?.textContent).toBe(
      "Production Monitor",
    );
    expect(container?.textContent).toContain("v1.0.0");
    expect(container?.textContent).toContain("owner/repo");
  });

  it("uses the repository name when the release title repeats the tag", () => {
    render(
      <ReleaseCardComponent
        enrichedRelease={makeRelease()}
        settings={baseSettings}
      />,
    );

    expect(container?.querySelector("h3")?.textContent).toBe("repo");
  });

  it("shows a separate pinned marker without a custom-settings badge", () => {
    const enrichedRelease = makeRelease();
    enrichedRelease.repoSettings = { isPinned: true };

    render(
      <ReleaseCardComponent
        enrichedRelease={enrichedRelease}
        settings={baseSettings}
      />,
    );

    expect(container?.textContent).toContain("Pinned");
    expect(container?.textContent).not.toContain("[Custom settings]");
    const pinnedBadge = container?.querySelector(".sr-only")?.parentElement;
    expect(pinnedBadge?.getAttribute("aria-label")).toBe("Pinned to top");
    expect(pinnedBadge?.tabIndex).toBe(0);
  });

  it("keeps the display name visible when release fetching fails", () => {
    const enrichedRelease: EnrichedRelease = {
      repoId: "owner/repo",
      repoUrl: "https://github.com/owner/repo",
      error: { type: "api_error" },
      repoSettings: { displayName: "Production Monitor" },
    };

    render(
      <ReleaseCardComponent
        enrichedRelease={enrichedRelease}
        settings={baseSettings}
      />,
    );

    expect(container?.querySelector("h3")?.textContent).toBe(
      "Production Monitor",
    );
    expect(container?.textContent).toContain("owner/repo");
  });

  it("renders repository tags on a release card", () => {
    render(
      <ReleaseCardComponent
        enrichedRelease={makeRelease()}
        repositoryTags={["infra", "media"]}
        settings={baseSettings}
      />,
    );

    expect(container?.textContent).toContain("infra");
    expect(container?.textContent).toContain("media");
  });

  it("exposes hidden repository tags through a labelled keyboard trigger", () => {
    render(
      <ReleaseCardComponent
        enrichedRelease={makeRelease()}
        repositoryTags={["one", "two", "three", "four", "five"]}
        settings={baseSettings}
      />,
    );

    const moreTagsButton = container?.querySelector<HTMLButtonElement>(
      'button[aria-label="2 more repository tags: four, five"]',
    );
    expect(moreTagsButton).not.toBeNull();
    expect(moreTagsButton?.type).toBe("button");
  });

  it("shows remove button even when release data is missing", async () => {
    const enrichedRelease: EnrichedRelease = {
      repoId: "owner/repo",
      repoUrl: "https://github.com/owner/repo",
      repoSettings: {},
    };

    render(
      <ReleaseCardComponent
        enrichedRelease={enrichedRelease}
        settings={baseSettings}
      />,
    );

    expect(getElementByText("a", "owner/repo")).toBeTruthy();
    const removeButton = Array.from(
      container?.querySelectorAll("button") ?? [],
    ).find((btn) => btn.textContent?.includes("Remove repository"));
    expect(removeButton).toBeTruthy();
  });

  it("renders error state with translated message and custom settings badge", async () => {
    const enrichedRelease: EnrichedRelease = {
      repoId: "owner/repo",
      repoUrl: "https://github.com/owner/repo",
      error: { type: "repo_not_found" },
      repoSettings: {
        releaseChannels: ["stable"],
      },
    };

    render(
      <ReleaseCardComponent
        enrichedRelease={enrichedRelease}
        settings={baseSettings}
      />,
    );

    expect(getElementByText("a", "owner/repo")).toBeTruthy();
    expect(getElementByText("p", "Repository not found")).toBeTruthy();
    expect(container?.textContent?.includes("Custom settings")).toBe(true);
    const settingsButton = container?.querySelector(
      'button[aria-label="Open repository settings"]',
    );
    expect(settingsButton).toBeTruthy();
  });

  it("returns focus to the settings trigger after closing from an error card", async () => {
    vi.useFakeTimers();
    const enrichedRelease: EnrichedRelease = {
      repoId: "owner/repo",
      repoUrl: "https://github.com/owner/repo",
      error: { type: "repo_not_found" },
      repoSettings: {},
    };

    render(
      <ReleaseCardComponent
        enrichedRelease={enrichedRelease}
        settings={baseSettings}
      />,
    );

    const settingsButton = container?.querySelector(
      'button[aria-label="Open repository settings"]',
    ) as HTMLButtonElement | null;
    await act(async () => settingsButton?.click());
    const closeButton = getElementByText("button", "Close settings") as
      | HTMLButtonElement
      | undefined;
    await act(async () => closeButton?.click());
    await act(async () => vi.advanceTimersByTime(0));

    expect(document.activeElement).toBe(settingsButton);
  });
});
