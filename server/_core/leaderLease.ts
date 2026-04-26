import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { siteSettings } from "../../drizzle/schema";
import { getDb } from "../db";
import { log } from "./logger";

/**
 * Multi-instance leader-election helper backed by a single row per worker name
 * in `site_settings`. The lease value is stored as `<instanceId>|<expiresAtMs>`.
 *
 * Acquisition is atomic via a single UPDATE … WHERE clause that succeeds only
 * if the existing lease is missing, expired, or already held by us. If the
 * UPDATE affects 0 rows, someone else holds the lease and we are not leader.
 */

export const INSTANCE_ID = crypto.randomBytes(8).toString("hex");

const DEFAULT_LEASE_MS = 60_000; // 60s lease, renewed every ~30s by callers.

function leaseKey(workerName: string) {
  return `worker_lease:${workerName}`;
}

function buildLeaseValue(expiresAtMs: number) {
  return `${INSTANCE_ID}|${expiresAtMs}`;
}

/**
 * Atomic lease acquisition / renewal. Returns true iff *this instance* now
 * holds the lease for `workerName` until at least `now + leaseMs`.
 */
export async function tryAcquireLease(
  workerName: string,
  leaseMs: number = DEFAULT_LEASE_MS,
): Promise<boolean> {
  const db = await getDb();
  if (!db) {
    // No DB → can't coordinate. Fall back to letting every instance run; the
    // operator is expected to use WORKERS_ENABLED=true on exactly one box.
    return true;
  }

  const key = leaseKey(workerName);
  const expiresAtMs = Date.now() + leaseMs;
  const newValue = buildLeaseValue(expiresAtMs);
  const nowMs = Date.now();

  // Step 1: try the atomic UPDATE first. Single round-trip; only succeeds if
  // the row already exists AND (no lease OR expired OR ours).
  // Lease format: "<instanceId>|<expiresAtMs>"
  const updateResult: any = await db.execute(sql`
    UPDATE ${siteSettings}
    SET ${siteSettings.settingValue} = ${newValue},
        ${siteSettings.updatedAt} = NOW()
    WHERE ${siteSettings.settingKey} = ${key}
      AND (
        ${siteSettings.settingValue} IS NULL
        OR ${siteSettings.settingValue} = ''
        OR CAST(SUBSTRING_INDEX(${siteSettings.settingValue}, '|', -1) AS UNSIGNED) <= ${nowMs}
        OR SUBSTRING_INDEX(${siteSettings.settingValue}, '|', 1) = ${INSTANCE_ID}
      )
  `);

  // mysql2 returns affectedRows on the first element; drizzle's execute
  // typings are loose, so we read defensively.
  const affected =
    Number(updateResult?.[0]?.affectedRows ?? updateResult?.affectedRows ?? 0) || 0;

  if (affected > 0) return true;

  // Step 2: row may not exist yet. INSERT IGNORE so two racing instances don't
  // both succeed; the loser will fall back to UPDATE on next tick.
  try {
    await db.execute(sql`
      INSERT IGNORE INTO ${siteSettings} (${siteSettings.settingKey}, ${siteSettings.settingValue})
      VALUES (${key}, ${newValue})
    `);
    // Verify it's actually ours now (the INSERT IGNORE may have been a no-op).
    // mysql2's `db.execute` returns `[rows, fields]` where `rows` is an array
    // of plain objects. Drizzle's loose typing meant we previously read
    // `verifyRows[0][0].value` AND `verifyRows[0].value` defensively — both
    // shapes never coexist, and the wrong one returned undefined → spurious
    // "not leader" results. Pin to the correct mysql2 shape.
    const verifyRows = (await db.execute(sql`
      SELECT ${siteSettings.settingValue} AS value
      FROM ${siteSettings}
      WHERE ${siteSettings.settingKey} = ${key}
      LIMIT 1
    `)) as unknown as [Array<{ value?: string | null }>, unknown];
    const actualValue = verifyRows?.[0]?.[0]?.value ?? null;
    return Boolean(actualValue && actualValue.startsWith(`${INSTANCE_ID}|`));
  } catch (error) {
    log.warn("leaderLease", "insert_failed", {
      workerName,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export async function releaseLease(workerName: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const key = leaseKey(workerName);
  // Only release if it's actually ours.
  await db.execute(sql`
    UPDATE ${siteSettings}
    SET ${siteSettings.settingValue} = '',
        ${siteSettings.updatedAt} = NOW()
    WHERE ${siteSettings.settingKey} = ${key}
      AND SUBSTRING_INDEX(${siteSettings.settingValue}, '|', 1) = ${INSTANCE_ID}
  `);
}
