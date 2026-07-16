import { randomUUID } from "node:crypto";
import type { Stats } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { logger } from "@/lib/logger";

type JsonFileStoreOptions<T> = {
  filePath: string;
  defaultValue: T;
  scope: string;
  parse: (value: unknown) => T;
  writeErrorMessage: string | ((error: unknown) => string);
  initDirectoryErrorMessage?: string;
  initFileErrorMessage?: string;
};

export class JsonFileStore<T> {
  private readonly dataDirPath: string;
  private readonly log: ReturnType<typeof logger.withScope>;

  constructor(private readonly options: JsonFileStoreOptions<T>) {
    this.dataDirPath = path.dirname(options.filePath);
    this.log = logger.withScope(options.scope);
  }

  async ensureExists(): Promise<void> {
    try {
      await fs.mkdir(this.dataDirPath, { recursive: true });
    } catch (error) {
      this.log.error(
        `Failed to create data directory at ${this.dataDirPath}:`,
        error,
      );
      if (this.options.initDirectoryErrorMessage) {
        throw new Error(this.options.initDirectoryErrorMessage);
      }
      throw error;
    }

    try {
      await fs.access(this.options.filePath);
    } catch (error) {
      if (!isNodeErrorWithCode(error, "ENOENT")) {
        throw error;
      }
      try {
        await this.writeRaw(this.options.defaultValue);
        this.log.info(`Created data file at: ${this.options.filePath}`);
      } catch (error) {
        this.log.error(
          `Failed to write initial data file at ${this.options.filePath}:`,
          error,
        );
        if (this.options.initFileErrorMessage) {
          throw new Error(this.options.initFileErrorMessage);
        }
        throw error;
      }
    }
  }

  async stat(): Promise<Stats> {
    await this.ensureExists();
    return fs.stat(this.options.filePath);
  }

  async read(): Promise<T> {
    await this.ensureExists();
    try {
      const raw = await fs.readFile(this.options.filePath, "utf8");
      return this.options.parse(JSON.parse(raw));
    } catch (error) {
      this.log.error(`Error reading or parsing ${this.fileName}:`, error);
      throw error;
    }
  }

  async readRaw(): Promise<unknown> {
    await this.ensureExists();
    const raw = await fs.readFile(this.options.filePath, "utf8");
    return JSON.parse(raw);
  }

  async write(value: T): Promise<void> {
    await this.ensureExists();
    try {
      // Validate the exact JSON representation before replacing the current
      // file. This also catches values such as NaN that JSON.stringify would
      // silently convert to null.
      const serialized = JSON.stringify(value);
      if (serialized === undefined) {
        throw new Error("Value cannot be represented as JSON.");
      }
      const validatedValue = this.options.parse(JSON.parse(serialized));
      await this.writeRaw(validatedValue);
    } catch (error) {
      this.log.error(`Error writing to ${this.fileName}:`, error);
      const message =
        typeof this.options.writeErrorMessage === "function"
          ? this.options.writeErrorMessage(error)
          : this.options.writeErrorMessage;
      throw new Error(message);
    }
  }

  private async writeRaw(value: T): Promise<void> {
    const fileContent = `${JSON.stringify(value, null, 2)}\n`;
    const tempPath = path.join(
      this.dataDirPath,
      `.${path.basename(this.options.filePath)}.${process.pid}.${randomUUID()}.tmp`,
    );
    if (typeof fs.rename !== "function") {
      await fs.writeFile(this.options.filePath, fileContent, "utf8");
      return;
    }
    try {
      await fs.writeFile(tempPath, fileContent, "utf8");
      await fs.rename(tempPath, this.options.filePath);
    } catch (error) {
      try {
        await fs.rm(tempPath, { force: true });
      } catch (cleanupError) {
        this.log.warn(
          `Failed to remove temporary data file at ${tempPath}:`,
          cleanupError,
        );
      }
      throw error;
    }
  }

  private get fileName(): string {
    return path.basename(this.options.filePath);
  }
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}
