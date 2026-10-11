CREATE TABLE `profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `profiles_org_name_uidx` ON `profiles` (`org_id`,`name`);--> statement-breakpoint
CREATE INDEX `profiles_org_idx` ON `profiles` (`org_id`);--> statement-breakpoint
CREATE TABLE `profile_object_permissions` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`object_type` text NOT NULL,
	`can_create` integer NOT NULL,
	`can_read` integer NOT NULL,
	`can_update` integer NOT NULL,
	`can_delete` integer NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `profile_object_permissions_uidx` ON `profile_object_permissions` (`profile_id`,`object_type`);--> statement-breakpoint
CREATE TABLE `profile_field_permissions` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`object_type` text NOT NULL,
	`field_name` text NOT NULL,
	`can_read` integer NOT NULL,
	`can_edit` integer NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `profile_field_permissions_uidx` ON `profile_field_permissions` (`profile_id`,`object_type`,`field_name`);--> statement-breakpoint
ALTER TABLE `org_memberships` ADD `profile_id` text;--> statement-breakpoint
CREATE INDEX `org_memberships_profile_idx` ON `org_memberships` (`profile_id`);
