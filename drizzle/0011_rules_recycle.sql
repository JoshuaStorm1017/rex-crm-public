CREATE TABLE `assignment_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`owner_id` text NOT NULL,
	`object_type` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`is_system` integer DEFAULT false NOT NULL,
	`assign_to_id` text NOT NULL,
	`sort_order` integer DEFAULT 1 NOT NULL,
	`criteria` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assign_to_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `automation_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`owner_id` text NOT NULL,
	`object_type` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`is_system` integer DEFAULT false NOT NULL,
	`run_on` text NOT NULL,
	`field` text NOT NULL,
	`value` text NOT NULL,
	`criteria` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `duplicate_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`owner_id` text NOT NULL,
	`object_type` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`is_system` integer DEFAULT false NOT NULL,
	`match_field` text NOT NULL,
	`error_message` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
