import type { MockInstance } from "vitest";

const LEVELS = ["error", "warn", "info", "debug"] as const;

describe("logger levels", () => {
  const originalLogLevel = process.env.LOG_LEVEL;
  let spies: Record<(typeof LEVELS)[number], MockInstance>;

  beforeEach(() => {
    spies = {
      error: vi.spyOn(console, "error").mockImplementation(() => {}),
      warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
      // The logger writes INFO lines through console.log.
      info: vi.spyOn(console, "log").mockImplementation(() => {}),
      debug: vi.spyOn(console, "debug").mockImplementation(() => {}),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    if (originalLogLevel === undefined) {
      delete process.env.LOG_LEVEL;
    } else {
      process.env.LOG_LEVEL = originalLogLevel;
    }
  });

  // The logger reads its level at import, so every case loads a fresh copy.
  async function printedLevels(nodeEnv: string, logLevel: string | undefined) {
    vi.stubEnv("NODE_ENV", nodeEnv);
    if (logLevel === undefined) {
      delete process.env.LOG_LEVEL;
    } else {
      process.env.LOG_LEVEL = logLevel;
    }
    vi.resetModules();
    const { logger } = await import("@/lib/logger");
    const log = logger.withScope("LevelTest");
    for (const level of LEVELS) {
      log[level](`${level} line`);
    }
    return LEVELS.filter((level) => spies[level].mock.calls.length > 0);
  }

  it.each([
    ["silent", "production", "silent", []],
    ["none", "production", "none", []],
    ["silent in development", "development", "silent", []],
    ["error", "production", "error", ["error"]],
    ["warn", "production", "warn", ["error", "warn"]],
    ["info", "production", "info", ["error", "warn", "info"]],
    ["debug", "production", "debug", ["error", "warn", "info", "debug"]],
    ["verbose", "production", "verbose", ["error", "warn", "info", "debug"]],
    ["no level in production", "production", undefined, ["error", "warn"]],
    [
      "no level in development",
      "development",
      undefined,
      ["error", "warn", "info", "debug"],
    ],
    ["an unknown level in production", "production", "loud", ["error", "warn"]],
  ])(
    "prints the expected levels for %s",
    async (_label, nodeEnv, logLevel, expected) => {
      await expect(printedLevels(nodeEnv, logLevel)).resolves.toEqual(expected);
    },
  );
});
