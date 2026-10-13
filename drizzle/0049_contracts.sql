CREATE TABLE `contracts` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`account_id` text NOT NULL,
	`status` text NOT NULL,
	`start_date` text NOT NULL,
	`term_months` integer NOT NULL,
	`end_date` text NOT NULL,
	`value_cents` integer NOT NULL,
	`activated_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `contracts_org_idx` ON `contracts` (`org_id`);--> statement-breakpoint
CREATE INDEX `contracts_account_idx` ON `contracts` (`account_id`);