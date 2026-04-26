CREATE TABLE `daily_stats` (
	`id` int AUTO_INCREMENT NOT NULL,
	`date` varchar(10) NOT NULL,
	`pageviews` int NOT NULL DEFAULT 0,
	`uniqueVisitors` int NOT NULL DEFAULT 0,
	`whatsappClicks` int NOT NULL DEFAULT 0,
	`telegramClicks` int NOT NULL DEFAULT 0,
	`scroll25` int NOT NULL DEFAULT 0,
	`scroll50` int NOT NULL DEFAULT 0,
	`scroll75` int NOT NULL DEFAULT 0,
	`scroll100` int NOT NULL DEFAULT 0,
	`avgTimeOnPage` int NOT NULL DEFAULT 0,
	`conversionRate` varchar(10) DEFAULT '0',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `daily_stats_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tracking_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`eventType` varchar(64) NOT NULL,
	`eventSource` varchar(128),
	`visitorId` varchar(128),
	`userAgent` varchar(512),
	`referrer` varchar(512),
	`ip` varchar(64),
	`country` varchar(64),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `tracking_events_id` PRIMARY KEY(`id`)
);
