import { logger } from "@/lib/logger";
import { isStaleServerActionError } from "@/lib/server-action-error";

let patched = false;

function describeSuppressedSource(source: string, devMode: boolean): string {
  return devMode
    ? `[Intercepted stale server action ${source}]`
    : "Suppressed stale server action request from outdated client.";
}

function argsContainStaleError(args: unknown[]): {
  match: boolean;
  error?: unknown;
} {
  for (const arg of args) {
    if (Array.isArray(arg)) {
      const nested = argsContainStaleError(arg);
      if (nested.match) {
        return nested;
      }
      continue;
    }
    if (isStaleServerActionError(arg)) {
      return { match: true, error: arg };
    }
  }
  return { match: false };
}

export function register(): void {
  if (patched || typeof console === "undefined") {
    return;
  }
  patched = true;

  const originalError = console.error.bind(console);
  const devMode = process.env.NODE_ENV !== "production";
  const log = logger.withScope("ServerActions");

  const reportSuppressed = (source: string, error: unknown) => {
    const message = describeSuppressedSource(source, devMode);
    if (devMode) {
      originalError(message, error);
    } else {
      log.debug(message);
    }
  };

  console.error = (...args: unknown[]) => {
    const { match, error } = argsContainStaleError(args);
    if (match) {
      reportSuppressed("console.error", error);
      return;
    }

    originalError(...args);
  };

  const handleUnhandledRejection = (reason: unknown) => {
    if (isStaleServerActionError(reason)) {
      reportSuppressed("unhandledRejection", reason);
      return;
    }
    originalError("Unhandled promise rejection:", reason);
  };

  const handleUncaughtException = (error: unknown) => {
    if (isStaleServerActionError(error)) {
      reportSuppressed("uncaughtException", error);
      return;
    }
    originalError("Uncaught exception:", error);
  };

  type StreamLike = {
    write?: (chunk: unknown, encoding?: unknown, callback?: unknown) => unknown;
  };

  type ProcessLike = {
    prependListener?: (
      event: string,
      listener: (...args: unknown[]) => void,
    ) => unknown;
    stderr?: StreamLike;
    stdout?: StreamLike;
  };

  const nodeProcess =
    typeof globalThis.process === "object" && globalThis.process !== null
      ? (globalThis.process as ProcessLike)
      : undefined;

  const hasProcessListeners = (
    proc: ProcessLike | undefined,
  ): proc is Required<Pick<ProcessLike, "prependListener">> & ProcessLike => {
    return !!proc && typeof proc.prependListener === "function";
  };

  if (typeof window === "undefined" && hasProcessListeners(nodeProcess)) {
    nodeProcess.prependListener("unhandledRejection", handleUnhandledRejection);
    nodeProcess.prependListener("uncaughtException", handleUncaughtException);
  } else if (devMode) {
    originalError(
      "[Instrumentation] process listeners unavailable; stale server-action errors might still surface as global rejections.",
    );
  } else {
    log.debug(
      "Instrumentation running without process listeners; only console errors will be filtered.",
    );
  }

  const nodeStderr =
    typeof nodeProcess === "object" && nodeProcess !== null
      ? (nodeProcess.stderr ?? undefined)
      : undefined;

  const nodeStdout =
    typeof nodeProcess === "object" && nodeProcess !== null
      ? (nodeProcess.stdout ?? undefined)
      : undefined;

  const extractText = (chunk: unknown): string | undefined => {
    if (typeof chunk === "string") {
      return chunk;
    }
    const hasBuffer =
      typeof Buffer !== "undefined" &&
      Buffer !== null &&
      typeof Buffer.isBuffer === "function";
    if (hasBuffer && Buffer.isBuffer(chunk)) {
      try {
        return (chunk as Buffer).toString();
      } catch {
        return undefined;
      }
    }
    if (
      typeof Uint8Array !== "undefined" &&
      chunk instanceof Uint8Array &&
      typeof TextDecoder !== "undefined"
    ) {
      try {
        const decoder = new TextDecoder();
        return decoder.decode(chunk);
      } catch {
        return undefined;
      }
    }
    if (
      typeof chunk === "object" &&
      chunk !== null &&
      typeof (chunk as { toString?: unknown }).toString === "function"
    ) {
      try {
        return (chunk as { toString: () => string }).toString();
      } catch {
        return undefined;
      }
    }
    return undefined;
  };

  const interceptStreamWrite = (
    stream: { write?: (...args: unknown[]) => unknown } | undefined,
    source: string,
  ) => {
    if (!stream || typeof stream.write !== "function") {
      return;
    }
    const originalWrite = stream.write.bind(stream);
    stream.write = ((chunk: unknown, encoding?: unknown, cb?: unknown) => {
      const text = extractText(chunk);
      if (text && isStaleServerActionError(text)) {
        reportSuppressed(source, text);
        if (typeof cb === "function") {
          (cb as () => void)();
        }
        return true;
      }
      return (originalWrite as (...args: unknown[]) => unknown)(
        chunk,
        encoding,
        cb,
      );
    }) as typeof stream.write;
  };

  interceptStreamWrite(nodeStderr, "stderr.write");
  interceptStreamWrite(nodeStdout, "stdout.write");
}
