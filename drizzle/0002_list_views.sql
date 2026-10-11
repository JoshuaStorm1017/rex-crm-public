CREATE TABLE `list_views` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`owner_id` text NOT NULL,
	`object_type` text NOT NULL,
	`is_system` integer DEFAULT false NOT NULL,
	`columns` text NOT NULL,
	`filters` text NOT NULL,
	`sort_field` text NOT NULL,
	`sort_direction` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
