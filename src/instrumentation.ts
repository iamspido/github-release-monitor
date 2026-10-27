import { logger } from "@/lib/logger";

let registered = false;

export async function register(): Promise<void> {
  if (registered) {
    return;
  }
  registered = true;

  if (typeof window === "undefined" && process.env.NEXT_RUNTIME === "nodejs") {
    // Remove temporary files that a crash left behind, before this start
    // writes any data file itself.
    await runStartStep("remove stale temporary data files", async () => {
      const { removeStaleTempFiles } = await import(
        "@/lib/storage/stale-temp-files"
      );
      await removeStaleTempFiles();
    });

    await runStartStep("record the version marker", async () => {
      const { writeVersionMarker } = await import(
        "@/lib/storage/version-marker"
      );
      await writeVersionMarker();
    });

    const { startBackgroundWorkers } = await import(
      "@/lib/runtime/background-workers"
    );
    startBackgroundWorkers();
  }
}

// A start step that fails, including the import of its module, only warns,
// so the background workers still start.
async function runStartStep(
  description: string,
  step: () => Promise<void>,
): Promise<void> {
  try {
    await step();
  } catch (error) {
    logger.withScope("Startup").warn(`Failed to ${description}:`, error);
  }
}
