-- Intentional no-op. The original 0008 statements (CREATE TABLE
-- telegram_update_log and ALTER TABLE bot_starts ADD firstStartedAt) are
-- exact duplicates of what 0007_funnel_hardening already applies, so a
-- fresh environment that processes migrations in order would crash on
-- "table already exists" / "duplicate column". Kept as a placeholder so
-- the migration ledger stays linear with the journal.
SELECT 1;
