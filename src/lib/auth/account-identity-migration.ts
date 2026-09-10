import { getAuthDb } from "@/lib/auth/db";

const obsoleteIssuerIndex = "account_issuer_accountId_uidx";

type SqliteColumn = {
  dflt_value: string | null;
  name: string;
  notnull: number;
  type: string;
};

type SqliteIndex = {
  name: string;
  unique: number;
};

function runImmediateTransaction<T>(
  db: ReturnType<typeof getAuthDb>,
  task: () => T,
): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = task();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function hasObsoleteIssuerSchema(db: ReturnType<typeof getAuthDb>) {
  const columns = db
    .prepare("PRAGMA table_info('account')")
    .all() as SqliteColumn[];
  const issuerColumn = columns.find((column) => column.name === "issuer");
  if (
    issuerColumn?.notnull !== 1 ||
    issuerColumn.dflt_value !== null ||
    issuerColumn.type.toUpperCase() !== "TEXT"
  ) {
    return false;
  }

  const obsoleteIndex = (
    db.prepare("PRAGMA index_list('account')").all() as SqliteIndex[]
  ).find((index) => index.name === obsoleteIssuerIndex && index.unique === 1);
  if (!obsoleteIndex) {
    return false;
  }

  const obsoleteIndexColumns = db
    .prepare(`PRAGMA index_info('${obsoleteIssuerIndex}')`)
    .all() as Array<{ name: string }>;
  if (
    obsoleteIndexColumns.length !== 2 ||
    obsoleteIndexColumns[0]?.name !== "issuer" ||
    !["accountId", "account_id"].includes(obsoleteIndexColumns[1]?.name ?? "")
  ) {
    return false;
  }

  return true;
}

export function migrateAuthAccountIdentities(db = getAuthDb()) {
  if (!hasObsoleteIssuerSchema(db)) {
    return false;
  }

  return runImmediateTransaction(db, () => {
    if (!hasObsoleteIssuerSchema(db)) {
      return false;
    }
    db.exec(`DROP INDEX IF EXISTS "${obsoleteIssuerIndex}"`);
    db.exec('ALTER TABLE "account" DROP COLUMN "issuer"');
    return true;
  });
}
