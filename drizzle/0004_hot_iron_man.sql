CREATE TABLE `file_deletions` (
	`object_key` text PRIMARY KEY NOT NULL,
	`message_id` text,
	`requested_by` text NOT NULL,
	`requested_at` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_file_deletions_requester` ON `file_deletions` (`requested_by`);--> statement-breakpoint
CREATE TABLE `passkey_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`challenge` text NOT NULL,
	`purpose` text NOT NULL,
	`browser_hash` text NOT NULL,
	`user_id` text,
	`session_hash` text,
	`auth_version` integer,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_passkey_challenges_expiry` ON `passkey_challenges` (`expires_at`);--> statement-breakpoint
CREATE TABLE `passkeys` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`public_key` text NOT NULL,
	`webauthn_user_id` text NOT NULL,
	`counter` integer DEFAULT 0 NOT NULL,
	`transports` text DEFAULT '[]' NOT NULL,
	`device_type` text NOT NULL,
	`backed_up` integer DEFAULT 0 NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	`last_challenge_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_passkeys_user` ON `passkeys` (`user_id`);--> statement-breakpoint
CREATE TABLE `security_events` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`target_id` text,
	`action` text NOT NULL,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_security_events_at` ON `security_events` (`at`);--> statement-breakpoint
CREATE INDEX `idx_security_events_target` ON `security_events` (`target_id`,`at`);--> statement-breakpoint
ALTER TABLE `access_tokens` ADD `expires_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `access_tokens` ADD `used_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `access_tokens` ADD `purpose` text DEFAULT 'invite' NOT NULL;--> statement-breakpoint
ALTER TABLE `people` ADD `passkey_enrolled` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `people` ADD `webauthn_user_id` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `id` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `auth_level` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `setup_token_hash` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `created_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `verified_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `last_seen_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `device_label` text DEFAULT 'Browser' NOT NULL;--> statement-breakpoint
ALTER TABLE `workspace` ADD `ai_enabled` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
-- Existing private links get a short enrollment window; legacy bearer sessions cannot open the app.
UPDATE access_tokens SET expires_at = created_at + 604800000 WHERE expires_at = 0;
--> statement-breakpoint
DELETE FROM sessions WHERE auth_level = 'legacy';
--> statement-breakpoint
-- Finish deletion that users already requested before this migration.
INSERT OR IGNORE INTO file_deletions (object_key,message_id,requested_by,requested_at)
SELECT a.object_key,m.id,m.user_id,CAST(strftime('%s','now') AS INTEGER)*1000 FROM attachments a JOIN messages m ON m.id = a.message_id WHERE m.deleted = 1;
--> statement-breakpoint
DELETE FROM attachments WHERE message_id IN (SELECT id FROM messages WHERE deleted = 1);
--> statement-breakpoint
DELETE FROM reactions WHERE message_id IN (SELECT id FROM messages WHERE deleted = 1);
