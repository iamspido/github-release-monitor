export function parseSmtpPort(value: string | undefined): number {
  const normalizedValue = value?.trim();
  if (!normalizedValue || !/^\d+$/.test(normalizedValue)) {
    return Number.NaN;
  }

  const port = Number(normalizedValue);
  return Number.isSafeInteger(port) && port >= 1 && port <= 65_535
    ? port
    : Number.NaN;
}

export function parseSmtpTlsRejectUnauthorized(
  value: string | undefined,
): boolean {
  return value !== "false";
}
