import { getAuthDb } from "@/lib/auth/db";

const ACCOUNT_ISSUERS = {
  credential: "local:credential",
  github: "local:oauth:github",
  google: "https://accounts.google.com",
} as const;

type AccountProvider = keyof typeof ACCOUNT_ISSUERS;

type SqliteColumn = {
  name: string;
  notnull: number;
};

type AccountIdentityRow = {
  id: string;
  userId: string;
  accountId: string;
  providerId: string;
  issuer?: string | null;
};

function quoteIdentifier(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function findColumn(columns: SqliteColumn[], candidates: string[]) {
  return columns.find((column) => candidates.includes(column.name))?.name;
}

function getAccountProvider(value: string): AccountProvider | null {
  const normalized = value.trim().toLowerCase();
  return normalized in ACCOUNT_ISSUERS ? (normalized as AccountProvider) : null;
}

function runImmediateTransaction(
  db: ReturnType<typeof getAuthDb>,
  task: () => void,
) {
  db.exec("BEGIN IMMEDIATE");
  try {
    task();
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function buildReplacementTableSql(createSql: string) {
  const tableNamePattern =
    /^(CREATE\s+TABLE\s+)(?:"account"|`account`|\[account\]|account)/i;
  if (!tableNamePattern.test(createSql)) {
    throw new Error(
      "Unable to migrate Better Auth account identities: unsupported account table definition.",
    );
  }
  const closingParenthesis = createSql.lastIndexOf(")");
  if (closingParenthesis < 0) {
    throw new Error(
      "Unable to migrate Better Auth account identities: invalid account table definition.",
    );
  }
  const renamed = createSql.replace(
    tableNamePattern,
    '$1"account_v17_migration"',
  );
  const renamedClosingParenthesis = renamed.lastIndexOf(")");
  return `${renamed.slice(0, renamedClosingParenthesis)}, "issuer" TEXT NOT NULL${renamed.slice(renamedClosingParenthesis)}`;
}

export function migrateAuthAccountIdentities(db = getAuthDb()) {
  const accountTable = db
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'account'",
    )
    .get() as { sql?: string | null } | undefined;
  if (!accountTable?.sql) return false;

  const columns = db
    .prepare("PRAGMA table_info('account')")
    .all() as SqliteColumn[];
  const issuerColumn = findColumn(columns, ["issuer"]);
  const accountIdColumn = findColumn(columns, ["accountId", "account_id"]);
  const providerIdColumn = findColumn(columns, ["providerId", "provider"]);
  const userIdColumn = findColumn(columns, ["userId", "user_id"]);
  const idColumn = findColumn(columns, ["id"]);
  if (!accountIdColumn || !providerIdColumn || !userIdColumn || !idColumn) {
    throw new Error(
      "Unable to migrate Better Auth account identities: required account columns are missing.",
    );
  }

  const selectedIssuer = issuerColumn
    ? `${quoteIdentifier(issuerColumn)} AS issuer`
    : "NULL AS issuer";
  const accounts = db
    .prepare(
      `SELECT ${quoteIdentifier(idColumn)} AS id, ${quoteIdentifier(userIdColumn)} AS userId, ${quoteIdentifier(accountIdColumn)} AS accountId, ${quoteIdentifier(providerIdColumn)} AS providerId, ${selectedIssuer} FROM account`,
    )
    .all() as AccountIdentityRow[];

  const identities = new Map<string, string>();
  let existingRowsNeedUpdate = false;
  for (const account of accounts) {
    const provider = getAccountProvider(account.providerId);
    if (!provider) {
      throw new Error(
        `Unable to migrate Better Auth account identities: unsupported providerId '${account.providerId}'.`,
      );
    }
    const accountId =
      provider === "credential" ? account.userId : account.accountId;
    if (
      account.issuer !== ACCOUNT_ISSUERS[provider] ||
      account.accountId !== accountId
    ) {
      existingRowsNeedUpdate = true;
    }
    if (!account.id || !account.userId || !accountId) {
      throw new Error(
        "Unable to migrate Better Auth account identities: an account has an empty identity field.",
      );
    }
    const key = `${ACCOUNT_ISSUERS[provider]}\u0000${accountId}`;
    const existingAccountId = identities.get(key);
    if (existingAccountId) {
      throw new Error(
        `Unable to migrate Better Auth account identities: accounts '${existingAccountId}' and '${account.id}' resolve to the same issuer/accountId pair.`,
      );
    }
    identities.set(key, account.id);
  }

  const indexExists = Boolean(
    db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'account_issuer_accountId_uidx'",
      )
      .get(),
  );
  if (
    issuerColumn &&
    columns.find((column) => column.name === issuerColumn)?.notnull === 1
  ) {
    if (!existingRowsNeedUpdate && indexExists) return false;
    const updateIssuer = db.prepare(
      `UPDATE account SET ${quoteIdentifier(issuerColumn)} = ?, ${quoteIdentifier(accountIdColumn)} = CASE WHEN lower(${quoteIdentifier(providerIdColumn)}) = 'credential' THEN ${quoteIdentifier(userIdColumn)} ELSE ${quoteIdentifier(accountIdColumn)} END WHERE lower(${quoteIdentifier(providerIdColumn)}) = ?`,
    );
    runImmediateTransaction(db, () => {
      for (const [provider, issuer] of Object.entries(ACCOUNT_ISSUERS)) {
        updateIssuer.run(issuer, provider);
      }
      if (!indexExists) {
        db.exec(
          `CREATE UNIQUE INDEX account_issuer_accountId_uidx ON account (${quoteIdentifier(issuerColumn)}, ${quoteIdentifier(accountIdColumn)})`,
        );
      }
    });
    return true;
  }
  if (issuerColumn) {
    throw new Error(
      "Unable to migrate Better Auth account identities: issuer already exists but is nullable. Restore the pre-upgrade database backup before retrying.",
    );
  }

  const schemaObjects = db
    .prepare(
      "SELECT type, name, sql FROM sqlite_master WHERE tbl_name = 'account' AND type IN ('index', 'trigger') AND sql IS NOT NULL ORDER BY type, name",
    )
    .all() as Array<{ type: string; name: string; sql: string }>;
  const originalColumnNames = columns.map((column) => column.name);
  const insertColumns = [
    ...originalColumnNames.map(quoteIdentifier),
    quoteIdentifier("issuer"),
  ].join(", ");
  const selectColumns = originalColumnNames
    .map((column) =>
      column === accountIdColumn
        ? `CASE WHEN lower(${quoteIdentifier(providerIdColumn)}) = 'credential' THEN ${quoteIdentifier(userIdColumn)} ELSE ${quoteIdentifier(accountIdColumn)} END`
        : quoteIdentifier(column),
    )
    .concat(
      `CASE lower(${quoteIdentifier(providerIdColumn)}) WHEN 'credential' THEN '${ACCOUNT_ISSUERS.credential}' WHEN 'github' THEN '${ACCOUNT_ISSUERS.github}' WHEN 'google' THEN '${ACCOUNT_ISSUERS.google}' END`,
    )
    .join(", ");
  const replacementSql = buildReplacementTableSql(accountTable.sql);

  runImmediateTransaction(db, () => {
    db.exec(replacementSql);
    db.exec(
      `INSERT INTO "account_v17_migration" (${insertColumns}) SELECT ${selectColumns} FROM account`,
    );
    db.exec('DROP TABLE "account"');
    db.exec('ALTER TABLE "account_v17_migration" RENAME TO "account"');
    for (const schemaObject of schemaObjects) {
      db.exec(schemaObject.sql);
    }
    db.exec(
      `CREATE UNIQUE INDEX account_issuer_accountId_uidx ON account ("issuer", ${quoteIdentifier(accountIdColumn)})`,
    );
  });
  return true;
}
