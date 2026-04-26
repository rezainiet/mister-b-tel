CREATE TABLE `meta_event_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`eventType` varchar(64) NOT NULL,
	`eventScope` varchar(64) NOT NULL,
	`eventId` varchar(128) NOT NULL,
	`funnelToken` varchar(128),
	`sessionToken` varchar(128),
	`telegramUserId` varchar(64),
	`requestPayloadJson` text,
	`responsePayloadJson` text,
	`httpStatus` int,
	`status` enum('queued','sent','failed','retrying','abandoned') NOT NULL DEFAULT 'queued',
	`errorCode` varchar(64),
	`errorSubcode` varchar(64),
	`errorMessage` text,
	`retryable` int NOT NULL DEFAULT 0,
	`attemptCount` int NOT NULL DEFAULT 0,
	`attemptedAt` timestamp,
	`completedAt` timestamp,
	`nextRetryAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `meta_event_logs_id` PRIMARY KEY(`id`),
	CONSTRAINT `meta_event_logs_eventId_unique` UNIQUE(`eventId`)
);
--> statement-breakpoint
CREATE TABLE `telegram_linkages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`telegramUserId` varchar(64) NOT NULL,
	`funnelToken` varchar(128),
	`sessionToken` varchar(128),
	`payloadType` varchar(32) NOT NULL DEFAULT 'group',
	`payloadSource` varchar(128),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`expiresAt` timestamp,
	`resolvedAt` timestamp,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `telegram_linkages_id` PRIMARY KEY(`id`),
	CONSTRAINT `telegram_linkages_telegramUserId_unique` UNIQUE(`telegramUserId`)
);
--> statement-breakpoint
ALTER TABLE `bot_starts` MODIFY COLUMN `metaSubscribeStatus` enum('pending','sent','failed','retrying','abandoned') NOT NULL DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE `telegram_joins` MODIFY COLUMN `metaEventSent` enum('pending','sent','failed','retrying','abandoned') NOT NULL DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE `bot_starts` ADD `funnelToken` varchar(128);--> statement-breakpoint
ALTER TABLE `bot_starts` ADD `attributionStatus` enum('attributed_start','organic_start','unknown_start','legacy_unattributed') DEFAULT 'unknown_start' NOT NULL;--> statement-breakpoint
ALTER TABLE `bot_starts` ADD `utmMedium` varchar(128);--> statement-breakpoint
ALTER TABLE `bot_starts` ADD `utmContent` varchar(256);--> statement-breakpoint
ALTER TABLE `bot_starts` ADD `utmTerm` varchar(256);--> statement-breakpoint
ALTER TABLE `bot_starts` ADD `fbp` varchar(512);--> statement-breakpoint
ALTER TABLE `telegram_joins` ADD `funnelToken` varchar(128);--> statement-breakpoint
ALTER TABLE `telegram_joins` ADD `attributionStatus` enum('attributed_join','unattributed_join','bypass_join','legacy_unattributed') DEFAULT 'unattributed_join' NOT NULL;--> statement-breakpoint
ALTER TABLE `telegram_joins` ADD `fbp` varchar(512);--> statement-breakpoint
ALTER TABLE `tracking_events` ADD `eventId` varchar(128);--> statement-breakpoint
ALTER TABLE `tracking_events` ADD `sessionToken` varchar(128);--> statement-breakpoint
ALTER TABLE `tracking_events` ADD `funnelToken` varchar(128);--> statement-breakpoint
ALTER TABLE `tracking_events` ADD `sourceUrl` text;--> statement-breakpoint
ALTER TABLE `utm_sessions` ADD `funnelToken` varchar(128);--> statement-breakpoint
ALTER TABLE `utm_sessions` ADD `visitorId` varchar(128);