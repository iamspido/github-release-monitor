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
      ('credential-row', 'legacy-credential-id', 'credential', 'user-1', 'hash', 1, 1),
      ('github-row', 'github-user', 'github', 'user-2', NULL, 1, 1),
      ('google-row', 'google-user', 'google', 'user-3', NULL, 1, 1);
  `);
  return db;
}

describe("Better Auth 1.7 account identity migration", () => {
  it("backfills issuers, preserves schema objects, and is idempotent", () => {
    const db = createLegacyDatabase();

    expect(migrateAuthAccountIdentities(db)).toBe(true);

    const columns = db.prepare("PRAGMA table_info('account')").all() as Array<{
      name: string;
      notnull: number;
    }>;
    expect(columns.find((column) => column.name === "issuer")?.notnull).toBe(1);
    expect(
      db.prepare("SELECT id, accountId, issuer FROM account ORDER BY id").all(),
    ).toEqual([
      {
        id: "credential-row",
        accountId: "user-1",
        issuer: "local:credential",
      },
      {
        id: "github-row",
        accountId: "github-user",
        issuer: "local:oauth:github",
      },
      {
        id: "google-row",
        accountId: "google-user",
        issuer: "https://accounts.google.com",
      },
    ]);
    const indexes = db.prepare("PRAGMA index_list('account')").all() as Array<{
      name: string;
      unique: number;
    }>;
    expect(indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "account_userId_idx" }),
        expect.objectContaining({
          name: "account_issuer_accountId_uidx",
          unique: 1,
        }),
      ]),
    );
    expect(migrateAuthAccountIdentities(db)).toBe(false);
    db.close();
  });

  it("fails before changing the schema when an issuer identity collides", () => {
    const db = createLegacyDatabase();
    db.exec(`
      INSERT INTO user (
        id, name, email, emailVerified, image, createdAt, updatedAt
      ) VALUES ('user-4', 'Four', 'four@example.test', 1, NULL, 1, 1);
      INSERT INTO account (
        id, accountId, providerId, userId, password, createdAt, updatedAt
      ) VALUES ('github-duplicate', 'github-user', 'github', 'user-4', NULL, 1, 1);
    `);

    expect(() => migrateAuthAccountIdentities(db)).toThrow(
      "resolve to the same issuer/accountId pair",
    );
    const columns = db.prepare("PRAGMA table_info('account')").all() as Array<{
      name: string;
    }>;
    expect(columns.some((column) => column.name === "issuer")).toBe(false);
    db.close();
  });

  it("rejects unknown providers instead of guessing a trusted issuer", () => {
    const db = createLegacyDatabase();
    db.exec(`
      INSERT INTO user (
        id, name, email, emailVerified, image, createdAt, updatedAt
      ) VALUES ('user-4', 'Four', 'four@example.test', 1, NULL, 1, 1);
      INSERT INTO account (
        id, accountId, providerId, userId, password, createdAt, updatedAt
      ) VALUES ('unknown-row', 'external-id', 'custom', 'user-4', NULL, 1, 1);
    `);

    expect(() => migrateAuthAccountIdentities(db)).toThrow(
      "unsupported providerId 'custom'",
    );
    db.close();
  });

  it("leaves the schema ready for Better Auth's built-in migrations", async () => {
    const db = createLegacyDatabase();
    migrateAuthAccountIdentities(db);

    const migrations = await getMigrations({
      database: db,
      secret: "migration-test-secret-that-is-long-enough-123456789",
      baseURL: "http://localhost:3000",
      emailAndPassword: { enabled: true },
    });
    await expect(migrations.runMigrations()).resolves.toBeUndefined();
    expect(
      db
        .prepare(
          "SELECT count(*) AS count FROM account WHERE issuer IS NULL OR issuer = ''",
        )
        .get(),
    ).toEqual({ count: 0 });
    db.close();
  });
});
