import { getAuthDb } from "@/lib/auth/db";
import { logger } from "@/lib/logger";

const log = logger.withScope("Diagnostics");
const NONCE_TABLE = "grmSecretRevealNonce";
let nonceTableReady = false;

function ensureNonceTable() {
  if (nonceTableReady) return;
  getAuthDb().exec(
    `CREATE TABLE IF NOT EXISTS ${NONCE_TABLE} (
      nonce TEXT PRIMARY KEY,
      expiresAt INTEGER NOT NULL
    )`,
  );
  nonceTableReady = true;
}

export function consumeSecretRevealStepUpNonce(
  nonce: string,
  expiresAt: number,
) {
  const normalizedNonce = nonce.trim();
  const now = Date.now();
  if (!normalizedNonce || !Number.isFinite(expiresAt) || expiresAt <= now) {
    return false;
  }

  const database = getAuthDb();
  let transactionOpen = false;
  try {
    ensureNonceTable();
    database.exec("BEGIN IMMEDIATE");
    transactionOpen = true;
    database
      .prepare(`DELETE FROM ${NONCE_TABLE} WHERE expiresAt <= ?`)
      .run(now);
    const result = database
      .prepare(
        `INSERT OR IGNORE INTO ${NONCE_TABLE} (nonce, expiresAt) VALUES (?, ?)`,
      )
      .run(normalizedNonce, expiresAt) as { changes?: number };
    database.exec("COMMIT");
    transactionOpen = false;
    return result.changes === 1;
  } catch (error) {
    if (transactionOpen) {
      try {
        database.exec("ROLLBACK");
      } catch (rollbackError) {
        log.error(
          "Failed to roll back secret reveal nonce consumption.",
          rollbackError,
        );
      }
    }
    log.error("Failed to persist secret reveal nonce consumption.", error);
    return false;
  }
}
