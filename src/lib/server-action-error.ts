const SERVER_ACTION_DIGEST_HINTS = [
  "NEXT_UNDEFINED_ACTION",
  "NEXT_SERVER_ACTION_NOT_FOUND",
] as const;

function extractMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null) return String(error);
  return "";
}

function extractDigest(error: unknown): string | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof (error as { digest?: unknown }).digest === "string"
  ) {
    return (error as { digest: string }).digest;
  }
  return undefined;
}

export function isStaleServerActionError(error: unknown): boolean {
  const message = extractMessage(error);
  const digest = extractDigest(error);
  if (!message && !digest) {
    return false;
  }

  const normalizedMessage = message.toLowerCase();
  const matchesKnownMessage =
    message.includes("Failed to find Server Action") ||
    (normalizedMessage.includes("server action") &&
      normalizedMessage.includes("not found"));
  const matchesKnownDigest =
    typeof digest === "string" &&
    SERVER_ACTION_DIGEST_HINTS.some((token) => digest.includes(token));

  return matchesKnownMessage || matchesKnownDigest;
}

export function reloadIfServerActionStale(error: unknown): boolean {
  if (typeof window !== "undefined" && isStaleServerActionError(error)) {
    window.location.reload();
    return true;
  }

  return false;
}
