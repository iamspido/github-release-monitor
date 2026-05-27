import {
  filterRepositoriesDueForBackgroundCheck,
  getEffectiveBackgroundCheckCron,
  getEffectiveCacheIntervalMinutes,
  getEffectiveRefreshIntervalMinutes,
  isRepositoryDueForBackgroundCheck,
  isValidBackgroundCheckCron,
} from "@/lib/runtime/repository-schedule";
import type { AppSettings, Repository } from "@/types";

const settings = {
  refreshInterval: 10,
  cacheInterval: 5,
  backgroundCheckCron: undefined,
} as AppSettings;

describe("runtime/repository-schedule helpers", () => {
  it("treats interval repositories without a previous background check as due", () => {
    const repo = { id: "o/r", url: "https://github.com/o/r" } as Repository;

    expect(
      isRepositoryDueForBackgroundCheck(
        repo,
        settings,
        new Date("2024-01-01T10:00:00.000Z"),
      ),
    ).toBe(true);
  });

  it("checks interval repositories only after their effective interval elapsed", () => {
    const repo = {
      id: "o/r",
      url: "https://github.com/o/r",
      refreshInterval: 30,
      lastBackgroundCheckAt: "2024-01-01T10:00:00.000Z",
    } as Repository;

    expect(
      isRepositoryDueForBackgroundCheck(
        repo,
        settings,
        new Date("2024-01-01T10:29:59.000Z"),
      ),
    ).toBe(false);
    expect(
      isRepositoryDueForBackgroundCheck(
        repo,
        settings,
        new Date("2024-01-01T10:30:00.000Z"),
      ),
    ).toBe(true);
  });

  it("uses the global cron schedule when a repository has no automation override", () => {
    const repo = {
      id: "o/r",
      url: "https://github.com/o/r",
    } as Repository;

    expect(
      isRepositoryDueForBackgroundCheck(
        repo,
        { ...settings, backgroundCheckCron: "0 21 * * *" },
        new Date("2024-01-01T21:00:30.000Z"),
      ),
    ).toBe(true);
  });

  it("lets repository intervals override the global cron schedule", () => {
    const repo = {
      id: "o/r",
      url: "https://github.com/o/r",
      refreshInterval: 30,
      lastBackgroundCheckAt: "2024-01-01T20:45:00.000Z",
    } as Repository;

    expect(
      getEffectiveBackgroundCheckCron(repo, {
        backgroundCheckCron: "0 21 * * *",
      }),
    ).toBeUndefined();
    expect(
      isRepositoryDueForBackgroundCheck(
        repo,
        { ...settings, backgroundCheckCron: "0 21 * * *" },
        new Date("2024-01-01T21:00:30.000Z"),
      ),
    ).toBe(false);
  });

  it("accepts five-field cron and rejects non-five-field cron", () => {
    expect(isValidBackgroundCheckCron("0 21 * * *")).toBe(true);
    expect(isValidBackgroundCheckCron("0 0 21 * * *")).toBe(false);
  });

  it("runs cron repositories once for the current cron occurrence", () => {
    const repo = {
      id: "o/r",
      url: "https://github.com/o/r",
      backgroundCheckCron: "0 21 * * *",
    } as Repository;

    expect(
      isRepositoryDueForBackgroundCheck(
        repo,
        settings,
        new Date("2024-01-01T21:00:30.000Z"),
      ),
    ).toBe(true);

    expect(
      isRepositoryDueForBackgroundCheck(
        {
          ...repo,
          lastBackgroundCheckAt: "2024-01-01T21:00:45.000Z",
        },
        settings,
        new Date("2024-01-01T21:01:00.000Z"),
      ),
    ).toBe(false);
  });

  it("does not catch up stale cron occurrences outside the due window", () => {
    const repo = {
      id: "o/r",
      url: "https://github.com/o/r",
      backgroundCheckCron: "0 21 * * *",
    } as Repository;

    expect(
      isRepositoryDueForBackgroundCheck(
        repo,
        settings,
        new Date("2024-01-01T21:10:00.000Z"),
      ),
    ).toBe(false);
  });

  it("filters only due repositories", () => {
    const repos = [
      {
        id: "due/repo",
        url: "https://github.com/due/repo",
        lastBackgroundCheckAt: "2024-01-01T10:00:00.000Z",
      },
      {
        id: "fresh/repo",
        url: "https://github.com/fresh/repo",
        lastBackgroundCheckAt: "2024-01-01T10:09:59.000Z",
      },
    ] as Repository[];

    expect(
      filterRepositoriesDueForBackgroundCheck(
        repos,
        settings,
        new Date("2024-01-01T10:10:00.000Z"),
      ).map((repo) => repo.id),
    ).toEqual(["due/repo"]);
  });

  it("resolves per-repository cache overrides and global fallback", () => {
    expect(
      getEffectiveCacheIntervalMinutes({ cacheInterval: 0 }, settings),
    ).toBe(0);
    expect(
      getEffectiveCacheIntervalMinutes({ cacheInterval: 15 }, settings),
    ).toBe(15);
    expect(getEffectiveCacheIntervalMinutes({}, settings)).toBe(5);
  });

  it("treats null repository refresh and cache overrides as global fallback", () => {
    expect(
      getEffectiveRefreshIntervalMinutes({ refreshInterval: null }, settings),
    ).toBe(10);
    expect(
      getEffectiveCacheIntervalMinutes({ cacheInterval: null }, settings),
    ).toBe(5);
  });
});
