import { describe, expect, it, vi } from "vitest";
import { mapWithConcurrency } from "@/lib/concurrency";

describe("mapWithConcurrency", () => {
  it("limits concurrency and preserves input order", async () => {
    let active = 0;
    let maximumActive = 0;
    const releases: Array<() => void> = [];

    const resultPromise = mapWithConcurrency([3, 1, 2, 0], 2, async (value) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
      return value * 10;
    });

    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases.shift()?.();
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases.shift()?.();
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases.splice(0).forEach((release) => {
      release();
    });

    await expect(resultPromise).resolves.toEqual([30, 10, 20, 0]);
    expect(maximumActive).toBe(2);
  });

  it("uses one worker for invalid concurrency values", async () => {
    await expect(
      mapWithConcurrency([1, 2], 0, async (value) => value),
    ).resolves.toEqual([1, 2]);
    await expect(
      mapWithConcurrency([1, 2], Number.NaN, async (value) => value),
    ).resolves.toEqual([1, 2]);
  });
});
