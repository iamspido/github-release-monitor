// RFC 5321 path limit of 256 octets, without the angle brackets.
export const EMAIL_ADDRESS_MAX_LENGTH = 254;

/** Matches like `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`, but in linear time. */
export function isLikelyEmail(value: string): boolean {
  if (value.length > EMAIL_ADDRESS_MAX_LENGTH || /\s/.test(value)) return false;
  const at = value.indexOf("@");
  if (at < 1 || value.includes("@", at + 1)) return false;
  const dot = value.indexOf(".", at + 2);
  return dot !== -1 && dot < value.length - 1;
}
