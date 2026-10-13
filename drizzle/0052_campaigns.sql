CREATE TABLE `campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text DEFAULT '00D000000000LOCALORG0001' NOT NULL,
	`name` text NOT NULL,
	`owner_id` text NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`start_date` text,
	`end_date` text,
	`budget_cents` integer,
	`description` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `campaigns_org_idx` ON `campaigns` (`org_id`);