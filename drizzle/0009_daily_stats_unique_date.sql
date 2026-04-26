-- Single-row-per-date semantics for daily_stats. Required for the
-- single-statement INSERT … ON DUPLICATE KEY UPDATE used by recordEvent
-- (replaces the previous SELECT-then-INSERT/UPDATE 3-round-trip pattern).
-- Existing duplicate rows on the same date must be merged manually before
-- this migration runs; the application has only ever inserted one row per
-- date, so this is a no-op in practice.
ALTER TABLE `daily_stats` ADD UNIQUE INDEX `daily_stats_date_unique` (`date`);
