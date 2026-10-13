CREATE TABLE `activities` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`parent_type` text NOT NULL,
	`parent_id` text NOT NULL,
	`kind` text NOT NULL,
	`subject` text NOT NULL,
	`notes` text,
	`occurred_at` integer NOT NULL,
	`logged_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`logged_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `activities_org_parent_idx` ON `activities` (`org_id`,`parent_type`,`parent_id`,`occurred_at`);