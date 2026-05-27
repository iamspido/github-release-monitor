import { logger } from "@/lib/logger";
import { checkForNewReleases } from "@/lib/releases/checker";
import { runApplicationUpdateCheck } from "@/lib/runtime/update-check";

const log = logger.withScope("WebServer");

async function backgroundPollingLoop() {
  try {
    await checkForNewReleases({ skipCache: true, onlyDue: true });
  } catch (error) {
    log.error("Error during background check for new releases:", error);
  } finally {
    const pollingIntervalMs = 60 * 1000;

    log.info("Next background check scheduled in 1 minute.");
    setTimeout(backgroundPollingLoop, pollingIntervalMs);
  }
}

const UPDATE_CHECK_INTERVAL_MINUTES = 60;
const UPDATE_CHECK_INITIAL_DELAY_MS = 10_000;

async function backgroundUpdateCheckLoop() {
  const intervalMinutes = Math.max(UPDATE_CHECK_INTERVAL_MINUTES, 1);
  const intervalMs = intervalMinutes * 60 * 1000;
  const currentVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";

  try {
    await runApplicationUpdateCheck(currentVersion);
  } catch (error) {
    log.error("Error during application update check:", error);
  } finally {
    log.info(
      `Next application update check scheduled in ${intervalMinutes} minutes.`,
    );
    setTimeout(backgroundUpdateCheckLoop, intervalMs);
  }
}

export function startBackgroundWorkers(): void {
  if (
    process.env.NODE_ENV === "production" &&
    !process.env.BACKGROUND_POLLING_INITIALIZED
  ) {
    log.info(`Initializing dynamic background polling.`);
    process.env.BACKGROUND_POLLING_INITIALIZED = "true";
    setTimeout(backgroundPollingLoop, 5000);
  }

  if (
    process.env.NODE_ENV !== "test" &&
    !process.env.APP_UPDATE_CHECK_INITIALIZED
  ) {
    log.info("Initializing application update checker.");
    process.env.APP_UPDATE_CHECK_INITIALIZED = "true";
    setTimeout(backgroundUpdateCheckLoop, UPDATE_CHECK_INITIAL_DELAY_MS);
  }
}
