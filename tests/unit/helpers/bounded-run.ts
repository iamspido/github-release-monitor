import path from "node:path";
import { Worker } from "node:worker_threads";
import { build } from "esbuild";

// A super-linear matcher blocks its thread, so the real source runs in a worker
// that is terminated at the deadline. V8 stops a running regex at once.

const ROOT = path.resolve(import.meta.dirname, "../../..");
const LOAD_TIMEOUT_MS = 30_000;
const DEFAULT_DEADLINE_MS = 2_000;

export type BoundedResult<T> =
  | { finished: true; value: T }
  | { finished: false; deadlineMs: number };

const HARNESS = `
import { parentPort as boundedRunPort } from "node:worker_threads";
boundedRunPort?.on("message", async (input) => {
  try {
    boundedRunPort?.postMessage({ value: await run(input) });
  } catch (error) {
    boundedRunPort?.postMessage({ error: String(error) });
  }
});
boundedRunPort?.postMessage("ready");
`;

function waitForReady(worker: Worker): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("The bounded worker did not load.")),
      LOAD_TIMEOUT_MS,
    );
    worker.once("message", (message) => {
      clearTimeout(timer);
      if (message === "ready") resolve();
      else reject(new Error(`Unexpected first message: ${String(message)}`));
    });
    worker.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

/** Bundles a module that declares `async function run(input)`. */
export async function bundleBounded(source: string): Promise<string> {
  const bundle = await build({
    stdin: {
      contents: `${source}\n${HARNESS}`,
      loader: "ts",
      resolveDir: ROOT,
      sourcefile: "bounded-run.ts",
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    target: "node24",
    tsconfig: path.join(ROOT, "tsconfig.json"),
    external: ["better-sqlite3", "next", "next/*"],
    logLevel: "silent",
  });
  return bundle.outputFiles[0].text;
}

/** Waits at most `deadlineMs` after the worker has loaded `bundle`. */
export async function runBundled<T>(
  bundle: string,
  input: unknown,
  deadlineMs = DEFAULT_DEADLINE_MS,
): Promise<BoundedResult<T>> {
  const worker = new Worker(bundle, {
    eval: true,
    stdout: true,
    stderr: true,
  });
  try {
    await waitForReady(worker);
    return await new Promise<BoundedResult<T>>((resolve, reject) => {
      const timer = setTimeout(
        () => resolve({ finished: false, deadlineMs }),
        deadlineMs,
      );
      worker.once("message", (message: { value?: T; error?: string }) => {
        clearTimeout(timer);
        if (message.error !== undefined) reject(new Error(message.error));
        else resolve({ finished: true, value: message.value as T });
      });
      worker.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      worker.postMessage(input);
    });
  } finally {
    await worker.terminate();
  }
}

export async function runBounded<T>(
  source: string,
  input: unknown,
  options: { deadlineMs?: number } = {},
): Promise<BoundedResult<T>> {
  return runBundled<T>(
    await bundleBounded(source),
    input,
    options.deadlineMs ?? DEFAULT_DEADLINE_MS,
  );
}
