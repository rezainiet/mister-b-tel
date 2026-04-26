ALTER TABLE `bot_starts` ADD `metaSubscribeStatus` enum('pending','sent','failed') DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `bot_starts` ADD `metaSubscribeEventId` varchar(128);--> statement-breakpoint
ALTER TABLE `bot_starts` ADD `metaSubscribeSentAt` timestamp;