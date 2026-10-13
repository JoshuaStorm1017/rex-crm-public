CREATE TABLE `cases` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`account_id` text NOT NULL,
	`subject` text NOT NULL,
	`status` text NOT NULL,
	`priority` text NOT NULL,
	`origin` text NOT NULL,
	`owner_id` text NOT NULL,
	`closed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `cases_org_idx` ON `cases` (`org_id`);--> statement-breakpoint
CREATE INDEX `cases_account_idx` ON `cases` (`account_id`);