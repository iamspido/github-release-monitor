export type JsonObject = Record<string, unknown>;

export function assertJsonObject(value: unknown, path: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value as JsonObject;
}

export function assertOptionalField(
  object: JsonObject,
  key: string,
  predicate: (value: unknown) => boolean,
  expected: string,
): void {
  const value = object[key];
  if (value !== undefined && !predicate(value)) {
    throw new Error(`${key} must be ${expected}.`);
  }
}

export function isNullable(predicate: (value: unknown) => boolean) {
  return (value: unknown): boolean => value === null || predicate(value);
}

export const isString = (value: unknown): value is string =>
  typeof value === "string";
export const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
export const isBoolean = (value: unknown): value is boolean =>
  typeof value === "boolean";
export const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export function isArrayOf(
  predicate: (value: unknown) => boolean,
): (value: unknown) => boolean {
  return (value: unknown): boolean =>
    Array.isArray(value) && value.every(predicate);
}

export function isOneOf<const T extends readonly string[]>(values: T) {
  const allowed = new Set<string>(values);
  return (value: unknown): value is T[number] =>
    typeof value === "string" && allowed.has(value);
}
