import { logger } from "@/lib/logger";

export function getServerTimeZone(
  configuredTimeZone: string | undefined = process.env.TZ,
  runtimeTimeZone?: string,
): string {
  const configured = configuredTimeZone?.trim();
  if (configured) {
    try {
      return new Intl.DateTimeFormat("en", {
        timeZone: configured,
      }).resolvedOptions().timeZone;
    } catch (error) {
      logger
        .withScope("Settings")
        .warn(
          `Invalid server timezone '${configured}'. Falling back to the runtime timezone.`,
          error,
        );
    }
  }

  if (runtimeTimeZone) {
    try {
      return new Intl.DateTimeFormat("en", {
        timeZone: runtimeTimeZone,
      }).resolvedOptions().timeZone;
    } catch (error) {
      logger
        .withScope("Settings")
        .warn(
          `Invalid runtime timezone '${runtimeTimeZone}'. Falling back to UTC.`,
          error,
        );
      return "UTC";
    }
  }

  try {
    const resolvedTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (resolvedTimeZone) {
      return resolvedTimeZone;
    }
    logger
      .withScope("Settings")
      .warn("The runtime timezone could not be resolved. Falling back to UTC.");
  } catch (error) {
    logger
      .withScope("Settings")
      .warn(
        "The runtime timezone could not be resolved. Falling back to UTC.",
        error,
      );
  }
  return "UTC";
}
