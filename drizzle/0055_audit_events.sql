CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`object_key` text NOT NULL,
	`record_id` text NOT NULL,
	`action` text NOT NULL,
	`changes_json` text NOT NULL,
	`at` integer NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `audit_events_org_record_idx` ON `audit_events` (`org_id`,`object_key`,`record_id`,`at`);