export function normalizeApiErrorCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

export async function readApiErrorCode(
  response: Response,
): Promise<string | null> {
  try {
    const data = (await response.clone().json()) as {
      error?: unknown;
      code?: unknown;
    };
    return (
      normalizeApiErrorCode(data.error) || normalizeApiErrorCode(data.code)
    );
  } catch {
    return null;
  }
}

export async function postAuthJson<TResponse extends object>(
  path: string,
  body: unknown,
): Promise<{
  response: Response;
  data: Partial<TResponse>;
  errorCode: string | null;
}> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response
    .clone()
    .json()
    .catch(() => ({}))) as Partial<TResponse>;
  const errorCode =
    normalizeApiErrorCode((data as { error?: unknown }).error) ||
    normalizeApiErrorCode((data as { code?: unknown }).code);
  return { response, data, errorCode };
}
