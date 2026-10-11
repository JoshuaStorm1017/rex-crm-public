CREATE TABLE `organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `organizations` (`id`, `name`, `status`, `created_at`, `updated_at`)
VALUES ('00D000000000LOCALORG0001', 'Rex Local', 'active', 0, 0);--> statement-breakpoint
CREATE TABLE `org_memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `org_memberships_org_user_uidx` ON `org_memberships` (`org_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `org_memberships_user_idx` ON `org_memberships` (`user_id`);--> statement-breakpoint
ALTER TABLE `accounts` ADD `org_id` text DEFAULT '00D000000000LOCALORG0001' NOT NULL;--> statement-breakpoint
CREATE INDEX `accounts_org_idx` ON `accounts` (`org_id`);--> statement-breakpoint
ALTER TABLE `assignment_rules` ADD `org_id` text DEFAULT '00D000000000LOCALORG0001' NOT NULL;--> statement-breakpoint
CREATE INDEX `assignment_rules_org_idx` ON `assignment_rules` (`org_id`);--> statement-breakpoint
ALTER TABLE `automation_rules` ADD `org_id` text DEFAULT '00D000000000LOCALORG0001' NOT NULL;--> statement-breakpoint
CREATE INDEX `automation_rules_org_idx` ON `automation_rules` (`org_id`);--> statement-breakpoint
ALTER TABLE `contacts` ADD `org_id` text DEFAULT '00D000000000LOCALORG0001' NOT NULL;--> statement-breakpoint
CREATE INDEX `contacts_org_idx` ON `contacts` (`org_id`);--> statement-breakpoint
ALTER TABLE `custom_field_values` ADD `org_id` text DEFAULT '00D000000000LOCALORG0001' NOT NULL;--> statement-breakpoint
CREATE INDEX `custom_field_values_org_idx` ON `custom_field_values` (`org_id`);--> statement-breakpoint
ALTER TABLE `custom_fields` ADD `org_id` text DEFAULT '00D000000000LOCALORG0001' NOT NULL;--> statement-breakpoint
CREATE INDEX `custom_fields_org_idx` ON `custom_fields` (`org_id`);--> statement-breakpoint
ALTER TABLE `duplicate_rules` ADD `org_id` text DEFAULT '00D000000000LOCALORG0001' NOT NULL;--> statement-breakpoint
CREATE INDEX `duplicate_rules_org_idx` ON `duplicate_rules` (`org_id`);--> statement-breakpoint
ALTER TABLE `leads` ADD `org_id` text DEFAULT '00D000000000LOCALORG0001' NOT NULL;--> statement-breakpoint
CREATE INDEX `leads_org_idx` ON `leads` (`org_id`);--> statement-breakpoint
ALTER TABLE `list_views` ADD `org_id` text DEFAULT '00D000000000LOCALORG0001' NOT NULL;--> statement-breakpoint
CREATE INDEX `list_views_org_idx` ON `list_views` (`org_id`);--> statement-breakpoint
ALTER TABLE `opportunities` ADD `org_id` text DEFAULT '00D000000000LOCALORG0001' NOT NULL;--> statement-breakpoint
CREATE INDEX `opportunities_org_idx` ON `opportunities` (`org_id`);--> statement-breakpoint
ALTER TABLE `opportunity_contact_roles` ADD `org_id` text DEFAULT '00D000000000LOCALORG0001' NOT NULL;--> statement-breakpoint
CREATE INDEX `opportunity_contact_roles_org_idx` ON `opportunity_contact_roles` (`org_id`);--> statement-breakpoint
ALTER TABLE `recently_viewed` ADD `org_id` text DEFAULT '00D000000000LOCALORG0001' NOT NULL;--> statement-breakpoint
CREATE INDEX `recently_viewed_org_user_idx` ON `recently_viewed` (`org_id`,`user_id`);--> statement-breakpoint
ALTER TABLE `reports` ADD `org_id` text DEFAULT '00D000000000LOCALORG0001' NOT NULL;--> statement-breakpoint
CREATE INDEX `reports_org_idx` ON `reports` (`org_id`);--> statement-breakpoint
ALTER TABLE `sessions` ADD `active_org_id` text REFERENCES organizations(id);--> statement-breakpoint
UPDATE `sessions` SET `active_org_id` = '00D000000000LOCALORG0001' WHERE `active_org_id` IS NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `org_id` text DEFAULT '00D000000000LOCALORG0001' NOT NULL;--> statement-breakpoint
CREATE INDEX `tasks_org_idx` ON `tasks` (`org_id`);--> statement-breakpoint
ALTER TABLE `validation_rules` ADD `org_id` text DEFAULT '00D000000000LOCALORG0001' NOT NULL;--> statement-breakpoint
CREATE INDEX `validation_rules_org_idx` ON `validation_rules` (`org_id`);