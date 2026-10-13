CREATE TABLE `dashboard_components` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`dashboard_id` text NOT NULL,
	`report_id` text NOT NULL,
	`title` text NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`dashboard_id`) REFERENCES `dashboards`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`report_id`) REFERENCES `reports`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `dashboard_components_org_dash_idx` ON `dashboard_components` (`org_id`,`dashboard_id`);--> statement-breakpoint
CREATE TABLE `dashboards` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`name` text NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `dashboards_org_idx` ON `dashboards` (`org_id`);