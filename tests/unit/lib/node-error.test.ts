import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runInNewContext } from "node:vm";
import { expectTypeOf } from "vitest";
import { isNodeErrorWithCode } from "@/lib/node-error";

describe("node-error", () => {
  it("recognizes the code of a real file system error", async () => {
    let error: unknown;
    try {
      await fs.readFile(path.join(tmpdir(), "node-error-test-missing-file"));
    } catch (caught) {
      error = caught;
    }

    expect(isNodeErrorWithCode(error, "ENOENT")).toBe(true);
    expect(isNodeErrorWithCode(error, "EACCES")).toBe(false);
  });

  it("accepts a plain object with the code", () => {
    expect(isNodeErrorWithCode({ code: "ENOENT" }, "ENOENT")).toBe(true);
  });

  it("accepts an error from another realm", () => {
    const error: unknown = runInNewContext(
      'Object.assign(new Error("missing"), { code: "ENOENT" })',
    );

    expect(error instanceof Error).toBe(false);
    expect(isNodeErrorWithCode(error, "ENOENT")).toBe(true);
  });

  it("keeps the type of a value with another code", () => {
    const value: { code: string; detail: number } = {
      code: "EEXIST",
      detail: 1,
    };

    if (!isNodeErrorWithCode(value, "ENOENT")) {
      // A type predicate on the helper would narrow this branch to never.
      expectTypeOf(value).toEqualTypeOf<{ code: string; detail: number }>();
      expect(value.detail).toBe(1);
    }
  });

  it.each([
    ["another code", { code: "EEXIST" }],
    ["a numeric code", { code: 2 }],
    ["an error without a code", new Error("ENOENT")],
    ["the code as a string", "ENOENT"],
    ["null", null],
    ["undefined", undefined],
  ])("rejects %s", (_label, value) => {
    expect(isNodeErrorWithCode(value, "ENOENT")).toBe(false);
  });
});
