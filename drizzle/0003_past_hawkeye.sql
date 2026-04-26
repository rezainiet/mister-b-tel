CREATE TABLE `telegram_reminder_jobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`telegramUserId` varchar(64) NOT NULL,
	`chatId` varchar(64) NOT NULL,
	`reminderKey` varchar(32) NOT NULL,
	`messageText` text NOT NULL,
	`dueAt` timestamp NOT NULL,
	`status` enum('pending','processing','sent','failed','skipped') NOT NULL DEFAULT 'pending',
	`attempts` int NOT NULL DEFAULT 0,
	`lastAttemptAt` timestamp,
	`sentAt` timestamp,
	`failedAt` timestamp,
	`skippedAt` timestamp,
	`skippedReason` varchar(128),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `telegram_reminder_jobs_id` PRIMARY KEY(`id`)
);
