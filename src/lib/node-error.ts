/**
 * Tells whether an error from a Node.js API carries the given code, such as
 * `ENOENT`. Any object with that code counts, so an error from another realm
 * that is not `instanceof Error` here is recognized too. It returns a plain
 * boolean, because a type predicate would narrow a value that already has a
 * `code` to `never` when the code differs.
 */
export function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === code
  );
}
