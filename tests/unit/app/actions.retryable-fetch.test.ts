import { beforeEach, describe, expect, it, vi } from "vitest";

const loggerScopeMock = {
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
};

describe("isRetryableFetchError", () => {
  let isRetryableFetchError: (
    error: unknown,
    options?: { warn?: (message: string) => void },
  ) => boolean;

  beforeEach(async () => {
    vi.resetModules();
    loggerScopeMock.debug.mockReset();
    loggerScopeMock.error.mockReset();
    loggerScopeMock.info.mockReset();
    loggerScopeMock.warn.mockReset();

    vi.doMock("@/lib/logger", () => ({
      logger: {
        withScope: vi.fn(() => loggerScopeMock),
      },
    }));

    const module = await import("@/lib/fetch-retry");
    isRetryableFetchError = module.isRetryableFetchError;
  });

  it("treats TypeError without a code as retryable", () => {
    expect(isRetryableFetchError(new TypeError("boom"))).toBe(true);
  });

  it("treats POSIX-style system errors as retryable", () => {
    const error = Object.assign(new Error("dns"), { code: "EAI_AGAIN" });
    expect(isRetryableFetchError(error)).toBe(true);
  });

  it("treats Undici errors as retryable", () => {
    const error = Object.assign(new Error("socket"), {
      code: "UND_ERR_SOCKET",
    });
    expect(isRetryableFetchError(error)).toBe(true);
  });

  it("treats unknown Undici error codes as retryable", () => {
    const error = Object.assign(new Error("socket"), {
      code: "UND_ERR_UNDERLYING",
    });
    expect(isRetryableFetchError(error)).toBe(true);
  });

  it("does not retry for ERR_* errors", () => {
    const error = Object.assign(new Error("invalid"), {
      code: "ERR_INVALID_URL",
    });
    expect(isRetryableFetchError(error)).toBe(false);
  });

  it("treats errors with numeric errno as retryable", () => {
    const error = Object.assign(new Error("dns"), {
      code: "SOME_UNKNOWN_CODE",
      errno: -3001,
    });
    expect(isRetryableFetchError(error)).toBe(true);
  });

  it("treats errors with numeric errno nested in cause as retryable", () => {
    const error = Object.assign(new Error("dns"), {
      cause: { errno: -3001 },
    });
    expect(isRetryableFetchError(error)).toBe(true);
  });

  it("treats retryable codes nested in cause as retryable", () => {
    const error = Object.assign(new Error("socket"), {
      cause: { code: "UND_ERR_SOCKET" },
    });
    expect(isRetryableFetchError(error)).toBe(true);
  });

  it("warns once for unclassified errors and treats them as non-retryable", () => {
    const error = Object.assign(new Error("weird"), {
      code: "UNCLASSIFIED_ERROR_CODE",
    });

    expect(isRetryableFetchError(error)).toBe(false);
    expect(loggerScopeMock.warn).toHaveBeenCalledTimes(1);
    loggerScopeMock.warn.mockClear();

    expect(isRetryableFetchError(error)).toBe(false);
    expect(loggerScopeMock.warn).not.toHaveBeenCalled();
  });

  it("warns for errors without a code", () => {
    const error = new Error("unknown");

    expect(isRetryableFetchError(error)).toBe(false);
    expect(loggerScopeMock.warn).toHaveBeenCalledWith(
      expect.stringContaining("without error code"),
    );
  });

  it("uses provided warn handler when available", () => {
    const error = Object.assign(new Error("weird"), {
      code: "UNCLASSIFIED_WITH_CUSTOM_WARN",
    });
    const customWarn = vi.fn();

    expect(isRetryableFetchError(error, { warn: customWarn })).toBe(false);
    expect(customWarn).toHaveBeenCalledWith(
      expect.stringContaining("UNCLASSIFIED_WITH_CUSTOM_WARN"),
    );
    expect(loggerScopeMock.warn).not.toHaveBeenCalled();
  });
});
