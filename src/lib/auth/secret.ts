import { timingSafeEqual } from "node:crypto";

export function secretsEqual(candidate: string, expected: string): boolean {
  const candidateBuffer = Buffer.from(candidate, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  if (candidateBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return timingSafeEqual(candidateBuffer, expectedBuffer);
}
