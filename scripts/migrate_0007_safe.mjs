#!/usr/bin/env node
/**
 * Safe applier for migration 0007_funnel_hardening.
 *
 *   1. Detects pre-existing duplicate (telegramUserId, channelId) rows in
 *      `telegram_joins` that would block the new UNIQUE constraint.
 *   2. Optionally collapses duplicates (keeps the EARLIEST id per pair) when
 *      run with --collapse-duplicates.
 *   3. Runs the migration via mysql2 against $DATABASE_URL.
 *   4. Verifies the new schema artifacts (table + unique index + indexes).
 *
 *   Usage:
 *     pnpm dlx tsx scripts/migrate_0007_safe.mjs           # dry run + apply
 *     pnpm dlx tsx scripts/migrate_0007_safe.mjs --collapse-duplicates
 *     pnpm dlx tsx scripts/migrate_0007_safe.mjs --check-only
 *
 *   Requires: DATABASE_URL env, mysql2 (already in deps).
 */

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const MIGRATION_FILE = path.join(REPO_ROOT, "drizzle", "0007_funnel_hardening.sql");

const args = new Set(process.argv.slice(2));
const COLLAPSE = args.has("--collapse-duplicates");
const CHECK_ONLY = args.has("--check-only");

if (!process.env.DATABASE_URL) {
  console.error("[migrate_0007] DATABASE_URL is required.");
  process.exit(1);
}

if (!fs.existsSync(MIGRATION_FILE)) {
  console.error(`[migrate_0007] Migration file not found: ${MIGRATION_FILE}`);
  process.exit(1);
}

const conn = await mysql.createConnection(process.env.DATABASE_URL);

try {
  console.log("[migrate_0007] Step 1: scanning for duplicate telegram_joins rows...");
  const [dupRows] = await conn.query(`
    SELECT telegramUserId, channelId, COUNT(*) AS n
    FROM telegram_joins
    GROUP BY telegramUserId, channelId
    HAVING n > 1
  `);

  if (dupRows.length > 0) {
    console.warn(`[migrate_0007] Found ${dupRows.length} duplicate (user, channel) groups:`);
    for (const row of dupRows.slice(0, 10)) {
      console.warn(`  - user=${row.telegramUserId} channel=${row.channelId} count=${row.n}`);
    }
    if (dupRows.length > 10) console.warn(`  ... and ${dupRows.length - 10} more`);

    if (!COLLAPSE) {
      console.error(
        "[migrate_0007] Refusing to apply migration: duplicates would violate the new UNIQUE constraint.\n" +
          "Re-run with --collapse-duplicates to keep the earliest id per (user, channel) pair, OR resolve manually first.",
      );
      process.exit(2);
    }

    console.log("[migrate_0007] Collapsing duplicates: keeping earliest id per (user, channel)...");
    const [delResult] = await conn.query(`
      DELETE tj1 FROM telegram_joins tj1
      INNER JOIN telegram_joins tj2
        ON tj1.telegramUserId = tj2.telegramUserId
       AND tj1.channelId = tj2.channelId
       AND tj1.id > tj2.id
    `);
    console.log(`[migrate_0007] Deleted ${delResult.affectedRows} duplicate rows.`);
  } else {
    console.log("[migrate_0007] No duplicate telegram_joins rows found. ✓");
  }

  if (CHECK_ONLY) {
    console.log("[migrate_0007] --check-only specified; not applying migration.");
    process.exit(0);
  }

  console.log("[migrate_0007] Step 2: applying migration 0007_funnel_hardening.sql...");
  const sqlText = fs.readFileSync(MIGRATION_FILE, "utf-8");
  // drizzle-kit splits on `--> statement-breakpoint`. We do the same.
  const statements = sqlText
    .split(/-->\s*statement-breakpoint\s*/g)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const statement of statements) {
    const preview = statement.replace(/\s+/g, " ").slice(0, 90);
    console.log(`  → ${preview}${statement.length > 90 ? "…" : ""}`);
    try {
      await conn.query(statement);
    } catch (error) {
      const code = error?.code || "";
      // Tolerate "object already exists" errors so the script is idempotent
      // when re-run after a partial application.
      if (
        code === "ER_TABLE_EXISTS_ERROR" ||
        code === "ER_DUP_KEYNAME" ||
        code === "ER_DUP_FIELDNAME"
      ) {
        console.log(`    (already applied: ${code})`);
        continue;
      }
      throw error;
    }
  }

  console.log("[migrate_0007] Step 3: verifying schema artifacts...");
  const [tables] = await conn.query(
    "SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'telegram_update_log'",
  );
  if (tables.length === 0) throw new Error("telegram_update_log table missing after migration");

  const [columns] = await conn.query(
    "SELECT COLUMN_NAME FROM information_schema.columns WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bot_starts' AND COLUMN_NAME = 'firstStartedAt'",
  );
  if (columns.length === 0) throw new Error("bot_starts.firstStartedAt column missing after migration");

  const [uniqIdx] = await conn.query(
    `SELECT INDEX_NAME FROM information_schema.statistics
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'telegram_joins'
       AND INDEX_NAME = 'telegram_joins_user_channel_unique'
       AND NON_UNIQUE = 0`,
  );
  if (uniqIdx.length === 0)
    throw new Error("telegram_joins UNIQUE(telegramUserId, channelId) missing after migration");

  console.log("[migrate_0007] All schema artifacts verified. ✓");
  console.log("[migrate_0007] Done.");
} finally {
  await conn.end();
}
