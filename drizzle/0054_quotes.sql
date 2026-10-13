CREATE TABLE `quote_line_items` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`quote_id` text NOT NULL,
	`product_id` text,
	`description` text NOT NULL,
	`quantity` integer NOT NULL,
	`unit_price_cents` integer NOT NULL,
	`discount_basis_points` integer DEFAULT 0 NOT NULL,
	`sort_order` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`quote_id`) REFERENCES `quotes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `quote_line_items_org_idx` ON `quote_line_items` (`org_id`);--> statement-breakpoint
CREATE INDEX `quote_line_items_quote_idx` ON `quote_line_items` (`quote_id`);--> statement-breakpoint
CREATE TABLE `quotes` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`opportunity_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text NOT NULL,
	`expiration_date` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	FOREIGN KEY (`opportunity_id`) REFERENCES `opportunities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `quotes_org_idx` ON `quotes` (`org_id`);--> statement-breakpoint
CREATE INDEX `quotes_opportunity_idx` ON `quotes` (`opportunity_id`);