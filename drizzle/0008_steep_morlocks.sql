CREATE TABLE `telegram_update_log` (
	`updateId` bigint NOT NULL,
	`processedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `telegram_update_log_updateId` PRIMARY KEY(`updateId`)
);
--> statement-breakpoint
ALTER TABLE `bot_starts` ADD `firstStartedAt` timestamp;