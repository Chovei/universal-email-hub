CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`avatar_url` text,
	`color` text DEFAULT '#6366F1' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`sync_cursor` text,
	`last_sync_at` integer,
	`sync_interval_seconds` integer DEFAULT 60 NOT NULL,
	`order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_email_idx` ON `accounts` (`email`);--> statement-breakpoint
CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer NOT NULL,
	`remote_ref` text NOT NULL,
	`local_path` text,
	`is_downloaded` integer DEFAULT false NOT NULL,
	`is_inline` integer DEFAULT false NOT NULL,
	`content_id` text,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `attachments_message_idx` ON `attachments` (`message_id`);--> statement-breakpoint
CREATE TABLE `folders` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`remote_id` text NOT NULL,
	`name` text NOT NULL,
	`type` text DEFAULT 'custom' NOT NULL,
	`total_count` integer DEFAULT 0 NOT NULL,
	`unread_count` integer DEFAULT 0 NOT NULL,
	`sync_cursor` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `folders_account_remote_idx` ON `folders` (`account_id`,`remote_id`);--> statement-breakpoint
CREATE INDEX `folders_account_type_idx` ON `folders` (`account_id`,`type`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`account_id` text NOT NULL,
	`folder_id` text,
	`remote_id` text NOT NULL,
	`from_address` text NOT NULL,
	`from_name` text,
	`to_addresses` text DEFAULT '[]' NOT NULL,
	`cc_addresses` text DEFAULT '[]' NOT NULL,
	`bcc_addresses` text DEFAULT '[]' NOT NULL,
	`reply_to_addresses` text DEFAULT '[]' NOT NULL,
	`subject` text DEFAULT '' NOT NULL,
	`body_html` text,
	`body_text` text,
	`date` integer NOT NULL,
	`is_read` integer DEFAULT false NOT NULL,
	`is_starred` integer DEFAULT false NOT NULL,
	`is_draft` integer DEFAULT false NOT NULL,
	`has_attachment` integer DEFAULT false NOT NULL,
	`labels` text DEFAULT '[]' NOT NULL,
	`headers` text DEFAULT '{}' NOT NULL,
	`size_bytes` integer,
	`fetched_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`folder_id`) REFERENCES `folders`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `messages_remote_idx` ON `messages` (`account_id`,`remote_id`);--> statement-breakpoint
CREATE INDEX `messages_thread_date_idx` ON `messages` (`thread_id`,`date`);--> statement-breakpoint
CREATE INDEX `messages_folder_date_idx` ON `messages` (`folder_id`,`date`);--> statement-breakpoint
CREATE INDEX `messages_account_date_idx` ON `messages` (`account_id`,`date`);--> statement-breakpoint
CREATE INDEX `messages_account_read_idx` ON `messages` (`account_id`,`is_read`);--> statement-breakpoint
CREATE INDEX `messages_account_starred_idx` ON `messages` (`account_id`,`is_starred`);--> statement-breakpoint
CREATE INDEX `messages_account_draft_idx` ON `messages` (`account_id`,`is_draft`);--> statement-breakpoint
CREATE TABLE `plugin_storage` (
	`plugin_id` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plugin_storage_pk` ON `plugin_storage` (`plugin_id`,`key`);--> statement-breakpoint
CREATE INDEX `plugin_storage_plugin_idx` ON `plugin_storage` (`plugin_id`);--> statement-breakpoint
CREATE TABLE `sync_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` text NOT NULL,
	`folder_id` text,
	`type` text NOT NULL,
	`priority` integer DEFAULT 5 NOT NULL,
	`payload` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`next_run_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sync_jobs_status_priority_idx` ON `sync_jobs` (`status`,`priority`,`next_run_at`);--> statement-breakpoint
CREATE INDEX `sync_jobs_account_idx` ON `sync_jobs` (`account_id`,`status`);--> statement-breakpoint
CREATE TABLE `threads` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`remote_id` text,
	`subject` text DEFAULT '' NOT NULL,
	`snippet` text DEFAULT '' NOT NULL,
	`last_message_at` integer NOT NULL,
	`unread_count` integer DEFAULT 0 NOT NULL,
	`message_count` integer DEFAULT 0 NOT NULL,
	`is_starred` integer DEFAULT false NOT NULL,
	`has_attachment` integer DEFAULT false NOT NULL,
	`labels` text DEFAULT '[]' NOT NULL,
	`participant_addresses` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `threads_account_last_msg_idx` ON `threads` (`account_id`,`last_message_at`);--> statement-breakpoint
CREATE INDEX `threads_remote_idx` ON `threads` (`account_id`,`remote_id`);--> statement-breakpoint
CREATE INDEX `threads_account_unread_idx` ON `threads` (`account_id`,`unread_count`);--> statement-breakpoint
CREATE INDEX `threads_account_starred_idx` ON `threads` (`account_id`,`is_starred`);