CREATE TABLE `active_schematics` (
	`character_id` text NOT NULL,
	`schematic_id` text NOT NULL,
	`source` text NOT NULL,
	`parent_schematic_id` text,
	`added_at` integer NOT NULL,
	PRIMARY KEY(`character_id`, `schematic_id`)
);
--> statement-breakpoint
CREATE TABLE `characters` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`galaxy_id` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `profession_priorities` (
	`character_id` text NOT NULL,
	`profession` text NOT NULL,
	`tier` text NOT NULL,
	`rank` integer NOT NULL,
	PRIMARY KEY(`character_id`, `profession`)
);
--> statement-breakpoint
CREATE TABLE `reference_meta` (
	`source` text PRIMARY KEY NOT NULL,
	`content_hash` text NOT NULL,
	`loaded_at` integer NOT NULL,
	`row_count` integer
);
--> statement-breakpoint
CREATE TABLE `resource_types` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`group_id` text NOT NULL,
	`parent_group` text,
	`cap_oq` integer DEFAULT 0 NOT NULL,
	`cap_cr` integer DEFAULT 0 NOT NULL,
	`cap_cd` integer DEFAULT 0 NOT NULL,
	`cap_dr` integer DEFAULT 0 NOT NULL,
	`cap_fl` integer DEFAULT 0 NOT NULL,
	`cap_hr` integer DEFAULT 0 NOT NULL,
	`cap_ma` integer DEFAULT 0 NOT NULL,
	`cap_pe` integer DEFAULT 0 NOT NULL,
	`cap_sr` integer DEFAULT 0 NOT NULL,
	`cap_ut` integer DEFAULT 0 NOT NULL,
	`cap_er` integer DEFAULT 0 NOT NULL,
	`floor_oq` integer DEFAULT 0 NOT NULL,
	`floor_cr` integer DEFAULT 0 NOT NULL,
	`floor_cd` integer DEFAULT 0 NOT NULL,
	`floor_dr` integer DEFAULT 0 NOT NULL,
	`floor_fl` integer DEFAULT 0 NOT NULL,
	`floor_hr` integer DEFAULT 0 NOT NULL,
	`floor_ma` integer DEFAULT 0 NOT NULL,
	`floor_pe` integer DEFAULT 0 NOT NULL,
	`floor_sr` integer DEFAULT 0 NOT NULL,
	`floor_ut` integer DEFAULT 0 NOT NULL,
	`floor_er` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `schematic_dependencies` (
	`parent_schematic_id` text NOT NULL,
	`child_schematic_id` text NOT NULL,
	`slot_name` text NOT NULL,
	PRIMARY KEY(`parent_schematic_id`, `child_schematic_id`, `slot_name`)
);
--> statement-breakpoint
CREATE TABLE `schematic_property_groups` (
	`id` integer PRIMARY KEY NOT NULL,
	`schematic_id` text NOT NULL,
	`property_name` text,
	`exp_group` text,
	`weight_total` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `schematic_property_weights` (
	`group_id` integer NOT NULL,
	`stat` text NOT NULL,
	`weight` integer NOT NULL,
	PRIMARY KEY(`group_id`, `stat`)
);
--> statement-breakpoint
CREATE TABLE `schematic_slots` (
	`schematic_id` text NOT NULL,
	`slot_name` text NOT NULL,
	`ingredient_type` integer NOT NULL,
	`ingredient_object` text NOT NULL,
	`units_required` integer NOT NULL,
	`contribution` integer,
	PRIMARY KEY(`schematic_id`, `slot_name`)
);
--> statement-breakpoint
CREATE TABLE `schematics` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`object_type` integer NOT NULL,
	`skill_group` text,
	`crafting_tab_bitmask` integer,
	`crafting_tab` text,
	`complexity` integer,
	`object_size` integer,
	`xp_type` text,
	`xp_amount` integer,
	`object_path` text,
	`parent_object_path` text
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text
);
