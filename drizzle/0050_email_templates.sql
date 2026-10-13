CREATE TABLE `email_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text DEFAULT '00D000000000LOCALORG0001' NOT NULL,
	`name` text NOT NULL,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `email_templates_org_idx` ON `email_templates` (`org_id`);