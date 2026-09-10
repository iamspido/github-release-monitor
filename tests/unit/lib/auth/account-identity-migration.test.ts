import { getMigrations } from "better-auth/db/migration";
import Database from "better-sqlite3";
import { migrateAuthAccountIdentities } from "@/lib/auth/account-identity-migration";

function createLegacyDatabase() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE user (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      emailVerified INTEGER NOT NULL,
      image TEXT,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    );
    CREATE TABLE account (
      id TEXT PRIMARY KEY,
      accountId TEXT NOT NULL,
      providerId TEXT NOT NULL,
      userId TEXT NOT NULL REFERENCES user(id),
      password TEXT,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    );
    CREATE INDEX account_userId_idx ON account (userId);
    INSERT INTO user (
      id, name, email, emailVerified, image, createdAt, updatedAt
    ) VALUES
      ('user-1', 'One', 'one@example.test', 1, NULL, 1, 1),
      ('user-2', 'Two', 'two@example.test', 1, NULL, 1, 1),
      ('user-3', 'Three', 'three@example.test', 1, NULL, 1, 1);
    INSERT INTO account (
      id, accountId, providerId, userId, password, createdAt, updatedAt
    ) VALUES
      ('credential-row', 'user-1', 'credential', 'user-1', 'hash', 1, 1),
      ('github-row', 'github-user', 'github', 'user-2', NULL, 1, 1),
      ('google-row', 'google-user', 'google', 'user-3', NULL, 1, 1);
  `);
  return db;
}

function addObsoleteIssuerSchema(db: ReturnType<typeof createLegacyDatabase>) {
  db.exec(`
    CREATE TABLE account_v17_migration (
      id TEXT PRIMARY KEY,
      accountId TEXT NOT NULL,
      providerId TEXT NOT NULL,
      userId TEXT NOT NULL REFERENCES user(id),
      password TEXT,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      issuer TEXT NOT NULL
    );
    INSERT INTO account_v17_migration (
      id, accountId, providerId, userId, password, createdAt, updatedAt, issuer
    )
    SELECT
      id,
      accountId,
      providerId,
      userId,
      password,
      createdAt,
      updatedAt,
      CASE providerId
        WHEN 'credential' THEN 'local:credential'
        WHEN 'github' THEN 'local:oauth:github'
        WHEN 'google' THEN 'https://accounts.google.com'
      END
    FROM account;
    DROP TABLE account;
    ALTER TABLE account_v17_migration RENAME TO account;
    CREATE INDEX account_userId_idx ON account (userId);
  `);
  db.exec(
    "CREATE UNIQUE INDEX account_issuer_accountId_uidx ON account (issuer, accountId)",
  );
}

function addNullableIssuerSchema(db: ReturnType<typeof createLegacyDatabase>) {
  db.exec("ALTER TABLE account ADD COLUMN issuer TEXT");
  db.prepare("UPDATE account SET issuer = ? WHERE id = ?").run(
    "custom-issuer",
    "github-row",
  );
  db.exec(
    "CREATE UNIQUE INDEX account_issuer_accountId_uidx ON account (issuer, accountId)",
  );
}

function getAccountColumns(db: ReturnType<typeof createLegacyDatabase>) {
  return db.prepare("PRAGMA table_info('account')").all() as Array<{
    name: string;
  }>;
}

describe("Better Auth 1.7 account identity migration", () => {
  it("leaves the restored Better Auth 1.6 account schema unchanged", () => {
    const db = createLegacyDatabase();
    const schemaBefore = db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'account'",
      )
      .get();

    expect(migrateAuthAccountIdentities(db)).toBe(false);
    expect(
      db
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'account'",
        )
        .get(),
    ).toEqual(schemaBefore);
    db.close();
  });

  it("removes the obsolete required issuer schema without changing account data", () => {
    const db = createLegacyDatabase();
    addObsoleteIssuerSchema(db);
    const accountsBefore = db
      .prepare(
        "SELECT id, accountId, providerId, userId, password, createdAt, updatedAt FROM account ORDER BY id",
      )
      .all();

    expect(migrateAuthAccountIdentities(db)).toBe(true);
    expect(
      getAccountColumns(db).some((column) => column.name === "issuer"),
    ).toBe(false);
    expect(
      db
        .prepare(
          "SELECT id, accountId, providerId, userId, password, createdAt, updatedAt FROM account ORDER BY id",
        )
        .all(),
    ).toEqual(accountsBefore);
    expect(db.prepare("PRAGMA index_list('account')").all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "account_userId_idx" }),
      ]),
    );
    expect(
      db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'account_issuer_accountId_uidx'",
        )
        .get(),
    ).toBeUndefined();
    expect(migrateAuthAccountIdentities(db)).toBe(false);
    db.close();
  });

  it("leaves a nullable issuer column and its data unchanged", () => {
    const db = createLegacyDatabase();
    addNullableIssuerSchema(db);

    expect(migrateAuthAccountIdentities(db)).toBe(false);
    expect(
      getAccountColumns(db).some((column) => column.name === "issuer"),
    ).toBe(true);
    expect(
      db.prepare("SELECT issuer FROM account WHERE id = 'github-row'").get(),
    ).toEqual({ issuer: "custom-issuer" });
    expect(
      db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'account_issuer_accountId_uidx'",
        )
        .get(),
    ).toEqual({ 1: 1 });
    db.close();
  });

  it("rechecks the schema after acquiring the write lock", () => {
    const db = createLegacyDatabase();
    addObsoleteIssuerSchema(db);
    const interleavedDb = {
      exec(sql: string) {
        if (sql === "BEGIN IMMEDIATE") {
          db.exec(`
            DROP INDEX account_issuer_accountId_uidx;
            ALTER TABLE account DROP COLUMN issuer;
          `);
        }
        return db.exec(sql);
      },
      prepare: db.prepare.bind(db),
    } as unknown as Parameters<typeof migrateAuthAccountIdentities>[0];

    expect(migrateAuthAccountIdentities(interleavedDb)).toBe(false);
    expect(
      getAccountColumns(db).some((column) => column.name === "issuer"),
    ).toBe(false);
    db.close();
  });

  it("leaves the schema ready for Better Auth's built-in migrations", async () => {
    const db = createLegacyDatabase();
    addObsoleteIssuerSchema(db);
    migrateAuthAccountIdentities(db);

    const migrations = await getMigrations({
      database: db,
      secret: "migration-test-secret-that-is-long-enough-123456789",
      baseURL: "http://localhost:3000",
      emailAndPassword: { enabled: true },
    });
    await expect(migrations.runMigrations()).resolves.toBeUndefined();
    expect(
      getAccountColumns(db).some((column) => column.name === "issuer"),
    ).toBe(false);
    db.close();
  });
});
