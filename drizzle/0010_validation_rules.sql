CREATE TABLE `validation_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`owner_id` text NOT NULL,
	`object_type` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`is_system` integer DEFAULT false NOT NULL,
	`error_message` text NOT NULL,
	`error_field` text,
	`criteria` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
