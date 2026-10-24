CREATE TABLE `custom_objects` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`api_name` text NOT NULL,
	`label` text NOT NULL,
	`label_plural` text NOT NULL,
	`description` text,
	`owner_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `custom_objects_org_api_uidx` ON `custom_objects` (`org_id`,`api_name`);--> statement-breakpoint
CREATE INDEX `custom_objects_org_idx` ON `custom_objects` (`org_id`);--> statement-breakpoint
CREATE TABLE `custom_object_records` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`object_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`owner_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`object_id`) REFERENCES `custom_objects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `custom_object_records_org_object_idx` ON `custom_object_records` (`org_id`,`object_id`);--> statement-breakpoint
CREATE INDEX `custom_object_records_owner_idx` ON `custom_object_records` (`owner_id`);
