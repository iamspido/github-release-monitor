export function reloadIfServerActionStale(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : typeof error === "object" && error !== null
          ? String(error)
          : "";

  if (
    typeof window !== "undefined" &&
    message.includes("Failed to find Server Action")
  ) {
    window.location.reload();
    return true;
  }

  return false;
}
