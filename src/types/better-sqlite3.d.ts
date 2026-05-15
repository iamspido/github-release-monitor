declare module "better-sqlite3" {
  interface Statement {
    run(...params: unknown[]): unknown;
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  }

  class Database {
    constructor(
      filename: string,
      options?: {
        readonly?: boolean;
        fileMustExist?: boolean;
        timeout?: number;
        verbose?: (...args: unknown[]) => void;
      },
    );
    prepare(sql: string): Statement;
    exec(sql: string): this;
    close(): void;
  }

  export = Database;
}
