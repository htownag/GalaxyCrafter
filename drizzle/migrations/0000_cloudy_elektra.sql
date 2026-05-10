CREATE TABLE `resource_observations` (
	`snapshot_id` text NOT NULL,
	`resource_id` text NOT NULL,
	PRIMARY KEY(`snapshot_id`, `resource_id`)
);
--> statement-breakpoint
CREATE TABLE `resource_planets` (
	`resource_id` text NOT NULL,
	`planet` text NOT NULL,
	PRIMARY KEY(`resource_id`, `planet`)
);
--> statement-breakpoint
CREATE TABLE `resources` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type_id` text NOT NULL,
	`type_display_name` text NOT NULL,
	`group_id` text NOT NULL,
	`entered_by` text,
	`added_date` integer NOT NULL,
	`galaxy_id` integer NOT NULL,
	`oq` integer,
	`cr` integer,
	`cd` integer,
	`dr` integer,
	`fl` integer,
	`hr` integer,
	`ma` integer,
	`pe` integer,
	`sr` integer,
	`ut` integer,
	`er` integer,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`galaxy_id` integer NOT NULL,
	`fetched_at` integer NOT NULL,
	`resource_count` integer NOT NULL
);
