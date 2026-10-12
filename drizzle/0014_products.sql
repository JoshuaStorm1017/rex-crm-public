CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text DEFAULT '00D000000000LOCALORG0001' NOT NULL,
	`name` text NOT NULL,
	`owner_id` text NOT NULL,
	`product_code` text,
	`family` text,
	`description` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `products_org_idx` ON `products` (`org_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `products_org_code_live_uidx` ON `products` (`org_id`,`product_code`) WHERE deleted_at is null and product_code is not null;--> statement-breakpoint
CREATE TABLE `price_books` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text DEFAULT '00D000000000LOCALORG0001' NOT NULL,
	`name` text NOT NULL,
	`owner_id` text NOT NULL,
	`is_standard` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `price_books_org_idx` ON `price_books` (`org_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `price_books_one_standard_uidx` ON `price_books` (`org_id`) WHERE is_standard = 1;--> statement-breakpoint
CREATE TABLE `price_book_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text DEFAULT '00D000000000LOCALORG0001' NOT NULL,
	`price_book_id` text NOT NULL,
	`product_id` text NOT NULL,
	`unit_price_cents` integer NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`price_book_id`) REFERENCES `price_books`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `price_book_entries_book_product_uidx` ON `price_book_entries` (`price_book_id`,`product_id`);--> statement-breakpoint
CREATE INDEX `price_book_entries_org_idx` ON `price_book_entries` (`org_id`);--> statement-breakpoint
CREATE INDEX `price_book_entries_product_idx` ON `price_book_entries` (`product_id`);
