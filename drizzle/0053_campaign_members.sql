CREATE TABLE `campaign_members` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text DEFAULT '00D000000000LOCALORG0001' NOT NULL,
	`campaign_id` text NOT NULL,
	`lead_id` text,
	`contact_id` text,
	`status` text DEFAULT 'sent' NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `campaign_members_org_idx` ON `campaign_members` (`org_id`);--> statement-breakpoint
CREATE INDEX `campaign_members_campaign_idx` ON `campaign_members` (`campaign_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `campaign_members_lead_uidx` ON `campaign_members` (`org_id`,`campaign_id`,`lead_id`) WHERE lead_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `campaign_members_contact_uidx` ON `campaign_members` (`org_id`,`campaign_id`,`contact_id`) WHERE contact_id is not null;