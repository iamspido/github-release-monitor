export function isSqliteMissingColumnError(error: unknown) {
  return (
    error instanceof Error &&
    error.message.toLowerCase().includes("no such column")
  );
}

export function isSqliteMissingTableError(error: unknown) {
  return (
    error instanceof Error &&
    error.message.toLowerCase().includes("no such table")
  );
}
