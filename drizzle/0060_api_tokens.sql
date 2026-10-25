CREATE TABLE `api_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_tokens_hash_uidx` ON `api_tokens` (`token_hash`);
--> statement-breakpoint
CREATE INDEX `api_tokens_org_user_idx` ON `api_tokens` (`org_id`,`user_id`);
