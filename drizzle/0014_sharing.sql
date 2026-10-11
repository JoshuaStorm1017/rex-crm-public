CREATE TABLE `org_wide_defaults` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`object_type` text NOT NULL,
	`access` text NOT NULL,
	`grant_hierarchy` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `org_wide_defaults_org_object_uidx` ON `org_wide_defaults` (`org_id`,`object_type`);
--> statement-breakpoint
CREATE TABLE `roles` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`name` text NOT NULL,
	`parent_role_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `roles_org_idx` ON `roles` (`org_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `roles_org_name_uidx` ON `roles` (`org_id`,`name`) WHERE `deleted_at` IS NULL;
--> statement-breakpoint
CREATE TABLE `sharing_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`name` text NOT NULL,
	`owner_id` text NOT NULL,
	`object_type` text NOT NULL,
	`access` text NOT NULL,
	`share_with_role_id` text NOT NULL,
	`include_subordinates` integer NOT NULL,
	`active` integer NOT NULL,
	`criteria` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `sharing_rules_org_idx` ON `sharing_rules` (`org_id`);
--> statement-breakpoint
ALTER TABLE `org_memberships` ADD `role_id` text;
--> statement-breakpoint
CREATE INDEX `org_memberships_role_idx` ON `org_memberships` (`role_id`);
