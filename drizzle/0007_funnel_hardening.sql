CREATE TABLE `telegram_update_log` (
	`updateId` bigint NOT NULL,
	`processedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `telegram_update_log_id` PRIMARY KEY(`updateId`)
);
--> statement-breakpoint
ALTER TABLE `bot_starts` ADD `firstStartedAt` timestamp;
--> statement-breakpoint
UPDATE `bot_starts` SET `firstStartedAt` = `startedAt` WHERE `firstStartedAt` IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `telegram_joins_user_channel_unique` ON `telegram_joins` (`telegramUserId`, `channelId`);
--> statement-breakpoint
CREATE INDEX `tracking_events_createdAt_idx` ON `tracking_events` (`createdAt`);
--> statement-breakpoint
CREATE INDEX `tracking_events_eventType_createdAt_idx` ON `tracking_events` (`eventType`, `createdAt`);
--> statement-breakpoint
CREATE INDEX `tracking_events_visitorId_idx` ON `tracking_events` (`visitorId`);
--> statement-breakpoint
CREATE INDEX `tracking_events_eventId_idx` ON `tracking_events` (`eventId`);
--> statement-breakpoint
CREATE INDEX `utm_sessions_funnelToken_idx` ON `utm_sessions` (`funnelToken`);
--> statement-breakpoint
CREATE INDEX `utm_sessions_visitorId_idx` ON `utm_sessions` (`visitorId`);
--> statement-breakpoint
CREATE INDEX `utm_sessions_createdAt_idx` ON `utm_sessions` (`createdAt`);
--> statement-breakpoint
CREATE INDEX `bot_starts_startedAt_idx` ON `bot_starts` (`startedAt`);
--> statement-breakpoint
CREATE INDEX `telegram_joins_joinedAt_idx` ON `telegram_joins` (`joinedAt`);
--> statement-breakpoint
CREATE INDEX `telegram_joins_telegramUserId_idx` ON `telegram_joins` (`telegramUserId`);
--> statement-breakpoint
CREATE INDEX `meta_event_logs_status_eventScope_idx` ON `meta_event_logs` (`status`, `eventScope`);
--> statement-breakpoint
CREATE INDEX `meta_event_logs_nextRetryAt_idx` ON `meta_event_logs` (`nextRetryAt`);
--> statement-breakpoint
CREATE INDEX `meta_event_logs_telegramUserId_idx` ON `meta_event_logs` (`telegramUserId`);
--> statement-breakpoint
CREATE INDEX `telegram_reminder_jobs_status_dueAt_idx` ON `telegram_reminder_jobs` (`status`, `dueAt`);
