CREATE TABLE `resource_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`depth` integer NOT NULL,
	`parent_category` text
);
--> statement-breakpoint
CREATE TABLE `resource_type_groups` (
	`type_id` text NOT NULL,
	`group_id` text NOT NULL,
	PRIMARY KEY(`type_id`, `group_id`)
);
--> statement-breakpoint
CREATE TABLE `sb_flags` (
	`resource_id` text NOT NULL,
	`snapshot_id` text NOT NULL,
	`for_profession` text NOT NULL,
	`tier` text NOT NULL,
	`score` real NOT NULL,
	`top_score_on_snapshot` real NOT NULL,
	`schematic_id` text,
	PRIMARY KEY(`resource_id`, `snapshot_id`, `for_profession`, `tier`)
);
--> statement-breakpoint
CREATE TABLE `verdicts` (
	`resource_id` text NOT NULL,
	`character_id` text NOT NULL,
	`snapshot_id` text NOT NULL,
	`tier` text NOT NULL,
	`reason` text,
	`top_score` real NOT NULL,
	`matched_schematic_count` integer DEFAULT 0 NOT NULL,
	`breakdown_json` text,
	`computed_at` integer NOT NULL,
	PRIMARY KEY(`resource_id`, `character_id`, `snapshot_id`)
);
