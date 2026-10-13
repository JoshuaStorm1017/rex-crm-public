CREATE TABLE `approval_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`opportunity_id` text NOT NULL,
	`submitted_by` text NOT NULL,
	`status` text NOT NULL,
	`comment` text DEFAULT '' NOT NULL,
	`decided_by` text,
	`created_at` integer NOT NULL,
	`decided_at` integer
);
--> statement-breakpoint
CREATE INDEX `approval_requests_org_opp_idx` ON `approval_requests` (`org_id`,`opportunity_id`);