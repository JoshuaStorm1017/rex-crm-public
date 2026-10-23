CREATE TABLE `case_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`case_id` text NOT NULL,
	`author_id` text NOT NULL,
	`body` text NOT NULL,
	`is_internal` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `case_comments_org_case_idx` ON `case_comments` (`org_id`,`case_id`);