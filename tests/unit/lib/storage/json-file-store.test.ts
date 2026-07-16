import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { JsonFileStore } from "@/lib/storage/json-file-store";

type TestValue = {
  value: string;
};

function parseTestValue(value: unknown): TestValue {
  if (
    value &&
    typeof value === "object" &&
    "value" in value &&
    typeof (value as { value?: unknown }).value === "string"
  ) {
    return { value: (value as { value: string }).value };
  }
  throw new Error("invalid test value");
}

describe("storage/JsonFileStore", () => {
  let tempDir: string;
  let filePath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "json-file-store-"));
    filePath = path.join(tempDir, "store.json");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  function createStore(options?: { defaultValue?: TestValue }) {
    return new JsonFileStore<TestValue>({
      filePath,
      defaultValue: options?.defaultValue ?? { value: "default" },
      scope: "JsonFileStoreTest",
      parse: parseTestValue,
      writeErrorMessage: "write failed",
    });
  }

  it("fails closed when the JSON file is corrupt", async () => {
    await writeFile(filePath, "{", "utf8");
    const store = createStore();

    await expect(store.read()).rejects.toBeInstanceOf(SyntaxError);
  });

  it("creates and replaces the JSON file through a temporary file without leaving temp files behind", async () => {
    const store = createStore();

    await store.write({ value: "next" });

    await expect(readFile(filePath, "utf8")).resolves.toBe(
      `${JSON.stringify({ value: "next" }, null, 2)}\n`,
    );
    await expect(readdir(tempDir)).resolves.toEqual(["store.json"]);
  });

  it("validates the serialized value before replacing existing data", async () => {
    const store = createStore();
    await store.write({ value: "existing" });

    await expect(
      store.write({ value: 42 } as unknown as TestValue),
    ).rejects.toThrow("write failed");

    await expect(store.read()).resolves.toEqual({ value: "existing" });
  });

  it("removes the temporary file when the atomic rename fails", async () => {
    await mkdir(filePath);
    const store = createStore();

    await expect(store.write({ value: "next" })).rejects.toThrow(
      "write failed",
    );

    await expect(readdir(tempDir)).resolves.toEqual(["store.json"]);
  });
});
