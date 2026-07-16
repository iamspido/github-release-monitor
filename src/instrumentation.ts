let registered = false;

export async function register(): Promise<void> {
  if (registered) {
    return;
  }
  registered = true;

  if (typeof window === "undefined" && process.env.NEXT_RUNTIME === "nodejs") {
    const { startBackgroundWorkers } = await import(
      "@/lib/runtime/background-workers"
    );
    startBackgroundWorkers();
  }
}
