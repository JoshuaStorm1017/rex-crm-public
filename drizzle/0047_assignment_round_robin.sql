ALTER TABLE `assignment_rules` ADD `assign_mode` text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE `assignment_rules` ADD `pool_user_ids` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `assignment_rules` ADD `rr_cursor` integer DEFAULT 0 NOT NULL;
