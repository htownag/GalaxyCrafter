CREATE TABLE `inventory_entries` (
	`character_id` text NOT NULL,
	`resource_id` text NOT NULL,
	`units` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`notes` text,
	`added_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`character_id`, `resource_id`)
);
