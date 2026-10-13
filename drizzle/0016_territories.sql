CREATE TABLE `territories` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`name` text NOT NULL,
	`regions` text NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `territories_org_name_uidx` ON `territories` (`org_id`,`name`);--> statement-breakpoint
CREATE TABLE `territory_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`territory_id` text NOT NULL,
	`account_id` text NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`territory_id`) REFERENCES `territories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `territory_accounts_account_uidx` ON `territory_accounts` (`account_id`);--> statement-breakpoint
CREATE INDEX `territory_accounts_territory_idx` ON `territory_accounts` (`territory_id`);--> statement-breakpoint
CREATE TABLE `territory_members` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`territory_id` text NOT NULL,
	`user_id` text NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`territory_id`) REFERENCES `territories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `territory_members_territory_user_uidx` ON `territory_members` (`territory_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `territory_members_org_idx` ON `territory_members` (`org_id`);