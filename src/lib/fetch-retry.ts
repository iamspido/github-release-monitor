import { logger } from "@/lib/logger";

const log = logger.withScope("FetchRetry");

const RETRYABLE_FETCH_ERROR_CODES = new Set([
  "UND_ERR_SOCKET",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_RESPONSE_TIMEOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
]);

const SYSTEM_ERROR_CODE_REGEX = /^E[A-Z0-9_]+$/;
const NODE_ERROR_PREFIX = "ERR_";
const NO_CODE_TOKEN = "<no-code>";

const reportedUnclassifiedFetchErrorCodes = new Set<string>();

type FetchErrorClassification = "retryable" | "non_retryable" | "unknown";

function getErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const maybeError = error as { code?: unknown; cause?: unknown };
  if (typeof maybeError.code === "string") {
    return maybeError.code;
  }
  if (maybeError.cause && typeof maybeError.cause === "object") {
    const cause = maybeError.cause as { code?: unknown };
    if (typeof cause.code === "string") {
      return cause.code;
    }
  }
  return undefined;
}

function getErrorErrno(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const maybeError = error as { errno?: unknown; cause?: unknown };
  if (typeof maybeError.errno === "number") {
    return maybeError.errno;
  }
  if (maybeError.cause && typeof maybeError.cause === "object") {
    const cause = maybeError.cause as { errno?: unknown };
    if (typeof cause.errno === "number") {
      return cause.errno;
    }
  }
  return undefined;
}

function isExplicitRetryableCode(code: string): boolean {
  return RETRYABLE_FETCH_ERROR_CODES.has(code);
}

function isUndiciErrorCode(code: string): boolean {
  return code.startsWith("UND_ERR_");
}

function isSystemErrorCode(code: string): boolean {
  return SYSTEM_ERROR_CODE_REGEX.test(code);
}

function isNodeNonRetryableCode(code: string): boolean {
  return code.startsWith(NODE_ERROR_PREFIX);
}

function hasNumericErrno(error: unknown): boolean {
  const errno = getErrorErrno(error);
  return typeof errno === "number";
}

function classifyFetchError(error: unknown): {
  category: FetchErrorClassification;
  code?: string;
} {
  const code = getErrorCode(error);
  if (!code) {
    if (hasNumericErrno(error)) {
      return { category: "retryable" };
    }
    if (error instanceof TypeError) {
      return { category: "retryable" };
    }
    return { category: "unknown" };
  }

  if (isExplicitRetryableCode(code)) {
    return { category: "retryable", code };
  }

  if (isUndiciErrorCode(code)) {
    return { category: "retryable", code };
  }

  if (isNodeNonRetryableCode(code)) {
    return { category: "non_retryable", code };
  }

  if (isSystemErrorCode(code)) {
    return { category: "retryable", code };
  }

  if (hasNumericErrno(error)) {
    return { category: "retryable", code };
  }

  return { category: "unknown", code };
}

function warnUnclassifiedCode(
  code: string | undefined,
  warn?: (message: string) => void,
): void {
  const key = code ?? NO_CODE_TOKEN;
  if (reportedUnclassifiedFetchErrorCodes.has(key)) {
    return;
  }
  reportedUnclassifiedFetchErrorCodes.add(key);

  const emit = warn ?? ((message: string) => log.warn(message));
  const descriptor = code ? `code "${code}"` : "without error code";
  emit(
    `Encountered unclassified fetch error ${descriptor}. Treating as non-retryable.`,
  );
}

export function isRetryableFetchError(
  error: unknown,
  options?: { warn?: (message: string) => void },
): boolean {
  const { category, code } = classifyFetchError(error);

  if (category === "retryable") {
    return true;
  }
  if (category === "non_retryable") {
    return false;
  }

  warnUnclassifiedCode(code, options?.warn);
  return false;
}
