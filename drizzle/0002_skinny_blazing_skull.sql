CREATE TABLE `bot_starts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`telegramUserId` varchar(64) NOT NULL,
	`telegramUsername` varchar(128),
	`telegramFirstName` varchar(128),
	`sessionToken` varchar(128),
	`utmSource` varchar(128),
	`utmCampaign` varchar(256),
	`fbclid` varchar(512),
	`reminderSent` enum('pending','sent','skipped') NOT NULL DEFAULT 'pending',
	`reminderSentAt` timestamp,
	`reminder2Sent` enum('pending','sent','skipped') NOT NULL DEFAULT 'pending',
	`reminder2SentAt` timestamp,
	`reminder3Sent` enum('pending','sent','skipped') NOT NULL DEFAULT 'pending',
	`reminder3SentAt` timestamp,
	`botBlocked` int NOT NULL DEFAULT 0,
	`joinedAt` timestamp,
	`startedAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `bot_starts_id` PRIMARY KEY(`id`),
	CONSTRAINT `bot_starts_telegramUserId_unique` UNIQUE(`telegramUserId`)
);
--> statement-breakpoint
CREATE TABLE `site_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`setting_key` varchar(100) NOT NULL,
	`setting_value` text NOT NULL,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `site_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `site_settings_setting_key_unique` UNIQUE(`setting_key`)
);
--> statement-breakpoint
CREATE TABLE `telegram_joins` (
	`id` int AUTO_INCREMENT NOT NULL,
	`telegramUserId` varchar(64) NOT NULL,
	`telegramUsername` varchar(128),
	`telegramFirstName` varchar(128),
	`telegramLastName` varchar(128),
	`channelId` varchar(64) NOT NULL,
	`channelTitle` varchar(256),
	`utmSource` varchar(128),
	`utmMedium` varchar(128),
	`utmCampaign` varchar(256),
	`utmContent` varchar(256),
	`utmTerm` varchar(256),
	`fbclid` varchar(512),
	`metaEventSent` enum('pending','sent','failed') NOT NULL DEFAULT 'pending',
	`metaEventId` varchar(128),
	`metaEventSentAt` timestamp,
	`sessionToken` varchar(128),
	`ipAddress` varchar(64),
	`userAgent` text,
	`joinedAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `telegram_joins_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `utm_sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sessionToken` varchar(128) NOT NULL,
	`utmSource` varchar(128),
	`utmMedium` varchar(128),
	`utmCampaign` varchar(256),
	`utmContent` varchar(256),
	`utmTerm` varchar(256),
	`fbclid` varchar(512),
	`ipAddress` varchar(64),
	`userAgent` text,
	`referrer` text,
	`landingPage` text,
	`clickedTelegramLink` enum('yes','no') NOT NULL DEFAULT 'no',
	`clickedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `utm_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `utm_sessions_sessionToken_unique` UNIQUE(`sessionToken`)
);
