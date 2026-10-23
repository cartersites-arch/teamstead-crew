CREATE TABLE `demo_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`object_key` text NOT NULL,
	`name` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `demo_messages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `demo_idx_attachments_message` ON `demo_attachments` (`message_id`);--> statement-breakpoint
CREATE TABLE `demo_invitations` (
	`email` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`room_ids` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `demo_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`user_id` text NOT NULL,
	`parent_id` text,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	`edited_at` integer,
	`deleted` integer DEFAULT 0 NOT NULL,
	`pinned` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `demo_rooms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `demo_people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `demo_idx_messages_room_parent_created` ON `demo_messages` (`room_id`,`parent_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `demo_idx_messages_parent` ON `demo_messages` (`parent_id`);--> statement-breakpoint
CREATE TABLE `demo_people` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`joined_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `demo_reactions` (
	`message_id` text NOT NULL,
	`user_id` text NOT NULL,
	`emoji` text NOT NULL,
	PRIMARY KEY(`message_id`, `user_id`, `emoji`),
	FOREIGN KEY (`message_id`) REFERENCES `demo_messages`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `demo_people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `demo_room_members` (
	`room_id` text NOT NULL,
	`user_id` text NOT NULL,
	`read_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`room_id`, `user_id`),
	FOREIGN KEY (`room_id`) REFERENCES `demo_rooms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `demo_people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `demo_idx_room_members_user` ON `demo_room_members` (`user_id`,`room_id`);--> statement-breakpoint
CREATE TABLE `demo_rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`kind` text DEFAULT 'channel' NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`dm_key` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `demo_idx_rooms_dm_key` ON `demo_rooms` (`dm_key`);--> statement-breakpoint
CREATE TABLE `demo_workspace` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` integer NOT NULL
);

CREATE TABLE `demo_maintenance_links` (
	`user_id` text PRIMARY KEY NOT NULL,
	`environment` text NOT NULL,
	`ciphertext` text NOT NULL,
	`iv` text NOT NULL,
	`connected_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `demo_people`(`id`) ON UPDATE no action ON DELETE no action
);

CREATE TABLE `demo_access_tokens` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `demo_people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `demo_idx_access_tokens_user` ON `demo_access_tokens` (`user_id`);--> statement-breakpoint
CREATE TABLE `demo_sessions` (
	`session_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`auth_version` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `demo_people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `demo_idx_sessions_user` ON `demo_sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `demo_idx_sessions_expiry` ON `demo_sessions` (`expires_at`);--> statement-breakpoint
ALTER TABLE `demo_people` ADD `auth_version` integer DEFAULT 1 NOT NULL;
ALTER TABLE `demo_workspace` ADD `access_bootstrapped` integer DEFAULT 0 NOT NULL;
CREATE TABLE `demo_file_deletions` (
	`object_key` text PRIMARY KEY NOT NULL,
	`message_id` text,
	`requested_by` text NOT NULL,
	`requested_at` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `demo_idx_file_deletions_requester` ON `demo_file_deletions` (`requested_by`);--> statement-breakpoint
CREATE TABLE `demo_passkey_challenges` (
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
CREATE INDEX `demo_idx_passkey_challenges_expiry` ON `demo_passkey_challenges` (`expires_at`);--> statement-breakpoint
CREATE TABLE `demo_passkeys` (
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
	FOREIGN KEY (`user_id`) REFERENCES `demo_people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `demo_idx_passkeys_user` ON `demo_passkeys` (`user_id`);--> statement-breakpoint
CREATE TABLE `demo_security_events` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`target_id` text,
	`action` text NOT NULL,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `demo_idx_security_events_at` ON `demo_security_events` (`at`);--> statement-breakpoint
CREATE INDEX `demo_idx_security_events_target` ON `demo_security_events` (`target_id`,`at`);--> statement-breakpoint
ALTER TABLE `demo_access_tokens` ADD `expires_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `demo_access_tokens` ADD `used_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `demo_access_tokens` ADD `purpose` text DEFAULT 'invite' NOT NULL;--> statement-breakpoint
ALTER TABLE `demo_people` ADD `passkey_enrolled` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `demo_people` ADD `webauthn_user_id` text;--> statement-breakpoint
ALTER TABLE `demo_sessions` ADD `id` text;--> statement-breakpoint
ALTER TABLE `demo_sessions` ADD `auth_level` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE `demo_sessions` ADD `setup_token_hash` text;--> statement-breakpoint
ALTER TABLE `demo_sessions` ADD `created_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `demo_sessions` ADD `verified_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `demo_sessions` ADD `last_seen_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `demo_sessions` ADD `device_label` text DEFAULT 'Browser' NOT NULL;--> statement-breakpoint
ALTER TABLE `demo_workspace` ADD `ai_enabled` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
-- Existing private links get a short enrollment window; legacy bearer sessions cannot open the app.
UPDATE demo_access_tokens SET expires_at = created_at + 604800000 WHERE expires_at = 0;
--> statement-breakpoint
DELETE FROM demo_sessions WHERE auth_level = 'legacy';
--> statement-breakpoint
-- Finish deletion that users already requested before this migration.
INSERT OR IGNORE INTO demo_file_deletions (object_key,message_id,requested_by,requested_at)
SELECT a.object_key,m.id,m.user_id,CAST(strftime('%s','now') AS INTEGER)*1000 FROM demo_attachments a JOIN demo_messages m ON m.id = a.message_id WHERE m.deleted = 1;
--> statement-breakpoint
DELETE FROM demo_attachments WHERE message_id IN (SELECT id FROM demo_messages WHERE deleted = 1);
--> statement-breakpoint
DELETE FROM demo_reactions WHERE message_id IN (SELECT id FROM demo_messages WHERE deleted = 1);

CREATE TABLE `demo_photo_budget` (
	`id` integer PRIMARY KEY NOT NULL,
	`used_bytes` integer DEFAULT 0 NOT NULL,
	`limit_bytes` integer DEFAULT 67108864 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `demo_photo_objects` (
	`object_key` text PRIMARY KEY NOT NULL,
	`size` integer NOT NULL,
	`body` blob NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO demo_photo_budget (id,used_bytes,limit_bytes) VALUES (1,0,67108864);
--> statement-breakpoint
-- The size and quota checks run inside the insertion transaction. Concurrent
-- uploads cannot reserve the same remaining space, and failures roll back.
CREATE TRIGGER demo_photo_objects_validate BEFORE INSERT ON demo_photo_objects
WHEN NEW.size < 1 OR NEW.size > 524288 OR length(NEW.body) <> NEW.size
BEGIN
  SELECT RAISE(ABORT, 'PHOTO_SIZE_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER demo_photo_objects_quota BEFORE INSERT ON demo_photo_objects
WHEN COALESCE((SELECT limit_bytes - used_bytes FROM demo_photo_budget WHERE id = 1), -1) < NEW.size
BEGIN
  SELECT RAISE(ABORT, 'PHOTO_BUDGET_FULL');
END;
--> statement-breakpoint
CREATE TRIGGER demo_photo_objects_account_insert AFTER INSERT ON demo_photo_objects
BEGIN
  UPDATE demo_photo_budget SET used_bytes = used_bytes + NEW.size WHERE id = 1;
END;
--> statement-breakpoint
CREATE TRIGGER demo_photo_objects_account_delete AFTER DELETE ON demo_photo_objects
BEGIN
  UPDATE demo_photo_budget SET used_bytes = used_bytes - OLD.size WHERE id = 1;
END;
--> statement-breakpoint
-- Photo keys are immutable. Replacements get a new key and go through quota
-- validation; message deletion is the only normal route to freeing bytes.
CREATE TRIGGER demo_photo_objects_no_update BEFORE UPDATE ON demo_photo_objects
BEGIN
  SELECT RAISE(ABORT, 'PHOTO_REPLACEMENT_NOT_ALLOWED');
END;

CREATE TABLE demo_bot_preferences (user_id TEXT PRIMARY KEY REFERENCES demo_people(id), enabled INTEGER NOT NULL DEFAULT 0, auth_version INTEGER NOT NULL, connection_iv TEXT NOT NULL, room_id TEXT NOT NULL UNIQUE REFERENCES demo_rooms(id), actor_id TEXT, snapshot TEXT NOT NULL DEFAULT '[]', last_attempt INTEGER NOT NULL DEFAULT 0, last_checked INTEGER NOT NULL DEFAULT 0, last_error TEXT NOT NULL DEFAULT '', lease_until INTEGER NOT NULL DEFAULT 0, lease_token TEXT NOT NULL DEFAULT '', enabled_at INTEGER NOT NULL);
CREATE TABLE demo_bot_events (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES demo_people(id), message_id TEXT NOT NULL REFERENCES demo_messages(id), created_at INTEGER NOT NULL, push_done INTEGER NOT NULL DEFAULT 0);
CREATE INDEX demo_idx_bot_events_push ON demo_bot_events(push_done,created_at);
CREATE TABLE demo_push_devices (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES demo_people(id), auth_version INTEGER NOT NULL, subscription TEXT NOT NULL, created_at INTEGER NOT NULL, last_sent INTEGER NOT NULL DEFAULT 0);
CREATE INDEX demo_idx_push_devices_user ON demo_push_devices(user_id);
INSERT INTO demo_people (id,email,name,role,active,joined_at) VALUES ('maintenance-bot','','Maintenance Bot','bot',0,0);

CREATE TABLE IF NOT EXISTS demo_chat_notification_preferences (user_id TEXT PRIMARY KEY REFERENCES demo_people(id), auth_version INTEGER NOT NULL, enabled INTEGER NOT NULL DEFAULT 0, enabled_at INTEGER NOT NULL, quiet_start INTEGER NOT NULL DEFAULT 1320, quiet_end INTEGER NOT NULL DEFAULT 420, quiet_enabled INTEGER NOT NULL DEFAULT 0, timezone TEXT NOT NULL DEFAULT 'UTC', muted_rooms TEXT NOT NULL DEFAULT '[]', last_attempt INTEGER NOT NULL DEFAULT 0, lease_until INTEGER NOT NULL DEFAULT 0, lease_token TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS demo_chat_push_receipts (device_id TEXT NOT NULL REFERENCES demo_push_devices(id) ON DELETE CASCADE, message_id TEXT NOT NULL REFERENCES demo_messages(id), created_at INTEGER NOT NULL, PRIMARY KEY(device_id,message_id));
CREATE TABLE IF NOT EXISTS demo_employee_status (user_id TEXT PRIMARY KEY REFERENCES demo_people(id), status TEXT NOT NULL CHECK(status IN ('available','working','away','driving')), expires_at INTEGER NOT NULL, auth_version INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS demo_conversation_preferences (
 user_id TEXT NOT NULL REFERENCES demo_people(id), room_id TEXT NOT NULL REFERENCES demo_rooms(id),
 favorite INTEGER NOT NULL DEFAULT 0, section TEXT NOT NULL DEFAULT '',
 notification TEXT NOT NULL DEFAULT 'mentions' CHECK(notification IN ('all','mentions','muted')),
 PRIMARY KEY(user_id,room_id)
);
CREATE TABLE IF NOT EXISTS demo_saved_messages (
 user_id TEXT NOT NULL REFERENCES demo_people(id), message_id TEXT NOT NULL REFERENCES demo_messages(id),
 saved_at INTEGER NOT NULL, PRIMARY KEY(user_id,message_id)
);
CREATE TABLE IF NOT EXISTS demo_crew_profiles (
 user_id TEXT PRIMARY KEY REFERENCES demo_people(id), job_title TEXT NOT NULL DEFAULT '',
 photo BLOB, photo_mime TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE `pilot_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`object_key` text NOT NULL,
	`name` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `pilot_messages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `pilot_idx_attachments_message` ON `pilot_attachments` (`message_id`);--> statement-breakpoint
CREATE TABLE `pilot_invitations` (
	`email` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`room_ids` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pilot_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`user_id` text NOT NULL,
	`parent_id` text,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	`edited_at` integer,
	`deleted` integer DEFAULT 0 NOT NULL,
	`pinned` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `pilot_rooms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `pilot_people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `pilot_idx_messages_room_parent_created` ON `pilot_messages` (`room_id`,`parent_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `pilot_idx_messages_parent` ON `pilot_messages` (`parent_id`);--> statement-breakpoint
CREATE TABLE `pilot_people` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`joined_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pilot_reactions` (
	`message_id` text NOT NULL,
	`user_id` text NOT NULL,
	`emoji` text NOT NULL,
	PRIMARY KEY(`message_id`, `user_id`, `emoji`),
	FOREIGN KEY (`message_id`) REFERENCES `pilot_messages`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `pilot_people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `pilot_room_members` (
	`room_id` text NOT NULL,
	`user_id` text NOT NULL,
	`read_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`room_id`, `user_id`),
	FOREIGN KEY (`room_id`) REFERENCES `pilot_rooms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `pilot_people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `pilot_idx_room_members_user` ON `pilot_room_members` (`user_id`,`room_id`);--> statement-breakpoint
CREATE TABLE `pilot_rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`kind` text DEFAULT 'channel' NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`dm_key` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pilot_idx_rooms_dm_key` ON `pilot_rooms` (`dm_key`);--> statement-breakpoint
CREATE TABLE `pilot_workspace` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` integer NOT NULL
);

CREATE TABLE `pilot_maintenance_links` (
	`user_id` text PRIMARY KEY NOT NULL,
	`environment` text NOT NULL,
	`ciphertext` text NOT NULL,
	`iv` text NOT NULL,
	`connected_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `pilot_people`(`id`) ON UPDATE no action ON DELETE no action
);

CREATE TABLE `pilot_access_tokens` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `pilot_people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pilot_idx_access_tokens_user` ON `pilot_access_tokens` (`user_id`);--> statement-breakpoint
CREATE TABLE `pilot_sessions` (
	`session_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`auth_version` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `pilot_people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `pilot_idx_sessions_user` ON `pilot_sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `pilot_idx_sessions_expiry` ON `pilot_sessions` (`expires_at`);--> statement-breakpoint
ALTER TABLE `pilot_people` ADD `auth_version` integer DEFAULT 1 NOT NULL;
ALTER TABLE `pilot_workspace` ADD `access_bootstrapped` integer DEFAULT 0 NOT NULL;
CREATE TABLE `pilot_file_deletions` (
	`object_key` text PRIMARY KEY NOT NULL,
	`message_id` text,
	`requested_by` text NOT NULL,
	`requested_at` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `pilot_idx_file_deletions_requester` ON `pilot_file_deletions` (`requested_by`);--> statement-breakpoint
CREATE TABLE `pilot_passkey_challenges` (
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
CREATE INDEX `pilot_idx_passkey_challenges_expiry` ON `pilot_passkey_challenges` (`expires_at`);--> statement-breakpoint
CREATE TABLE `pilot_passkeys` (
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
	FOREIGN KEY (`user_id`) REFERENCES `pilot_people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `pilot_idx_passkeys_user` ON `pilot_passkeys` (`user_id`);--> statement-breakpoint
CREATE TABLE `pilot_security_events` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`target_id` text,
	`action` text NOT NULL,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `pilot_idx_security_events_at` ON `pilot_security_events` (`at`);--> statement-breakpoint
CREATE INDEX `pilot_idx_security_events_target` ON `pilot_security_events` (`target_id`,`at`);--> statement-breakpoint
ALTER TABLE `pilot_access_tokens` ADD `expires_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `pilot_access_tokens` ADD `used_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `pilot_access_tokens` ADD `purpose` text DEFAULT 'invite' NOT NULL;--> statement-breakpoint
ALTER TABLE `pilot_people` ADD `passkey_enrolled` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `pilot_people` ADD `webauthn_user_id` text;--> statement-breakpoint
ALTER TABLE `pilot_sessions` ADD `id` text;--> statement-breakpoint
ALTER TABLE `pilot_sessions` ADD `auth_level` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE `pilot_sessions` ADD `setup_token_hash` text;--> statement-breakpoint
ALTER TABLE `pilot_sessions` ADD `created_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `pilot_sessions` ADD `verified_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `pilot_sessions` ADD `last_seen_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `pilot_sessions` ADD `device_label` text DEFAULT 'Browser' NOT NULL;--> statement-breakpoint
ALTER TABLE `pilot_workspace` ADD `ai_enabled` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
-- Existing private links get a short enrollment window; legacy bearer sessions cannot open the app.
UPDATE pilot_access_tokens SET expires_at = created_at + 604800000 WHERE expires_at = 0;
--> statement-breakpoint
DELETE FROM pilot_sessions WHERE auth_level = 'legacy';
--> statement-breakpoint
-- Finish deletion that users already requested before this migration.
INSERT OR IGNORE INTO pilot_file_deletions (object_key,message_id,requested_by,requested_at)
SELECT a.object_key,m.id,m.user_id,CAST(strftime('%s','now') AS INTEGER)*1000 FROM pilot_attachments a JOIN pilot_messages m ON m.id = a.message_id WHERE m.deleted = 1;
--> statement-breakpoint
DELETE FROM pilot_attachments WHERE message_id IN (SELECT id FROM pilot_messages WHERE deleted = 1);
--> statement-breakpoint
DELETE FROM pilot_reactions WHERE message_id IN (SELECT id FROM pilot_messages WHERE deleted = 1);

CREATE TABLE `pilot_photo_budget` (
	`id` integer PRIMARY KEY NOT NULL,
	`used_bytes` integer DEFAULT 0 NOT NULL,
	`limit_bytes` integer DEFAULT 67108864 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pilot_photo_objects` (
	`object_key` text PRIMARY KEY NOT NULL,
	`size` integer NOT NULL,
	`body` blob NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO pilot_photo_budget (id,used_bytes,limit_bytes) VALUES (1,0,67108864);
--> statement-breakpoint
-- The size and quota checks run inside the insertion transaction. Concurrent
-- uploads cannot reserve the same remaining space, and failures roll back.
CREATE TRIGGER pilot_photo_objects_validate BEFORE INSERT ON pilot_photo_objects
WHEN NEW.size < 1 OR NEW.size > 524288 OR length(NEW.body) <> NEW.size
BEGIN
  SELECT RAISE(ABORT, 'PHOTO_SIZE_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER pilot_photo_objects_quota BEFORE INSERT ON pilot_photo_objects
WHEN COALESCE((SELECT limit_bytes - used_bytes FROM pilot_photo_budget WHERE id = 1), -1) < NEW.size
BEGIN
  SELECT RAISE(ABORT, 'PHOTO_BUDGET_FULL');
END;
--> statement-breakpoint
CREATE TRIGGER pilot_photo_objects_account_insert AFTER INSERT ON pilot_photo_objects
BEGIN
  UPDATE pilot_photo_budget SET used_bytes = used_bytes + NEW.size WHERE id = 1;
END;
--> statement-breakpoint
CREATE TRIGGER pilot_photo_objects_account_delete AFTER DELETE ON pilot_photo_objects
BEGIN
  UPDATE pilot_photo_budget SET used_bytes = used_bytes - OLD.size WHERE id = 1;
END;
--> statement-breakpoint
-- Photo keys are immutable. Replacements get a new key and go through quota
-- validation; message deletion is the only normal route to freeing bytes.
CREATE TRIGGER pilot_photo_objects_no_update BEFORE UPDATE ON pilot_photo_objects
BEGIN
  SELECT RAISE(ABORT, 'PHOTO_REPLACEMENT_NOT_ALLOWED');
END;

CREATE TABLE pilot_bot_preferences (user_id TEXT PRIMARY KEY REFERENCES pilot_people(id), enabled INTEGER NOT NULL DEFAULT 0, auth_version INTEGER NOT NULL, connection_iv TEXT NOT NULL, room_id TEXT NOT NULL UNIQUE REFERENCES pilot_rooms(id), actor_id TEXT, snapshot TEXT NOT NULL DEFAULT '[]', last_attempt INTEGER NOT NULL DEFAULT 0, last_checked INTEGER NOT NULL DEFAULT 0, last_error TEXT NOT NULL DEFAULT '', lease_until INTEGER NOT NULL DEFAULT 0, lease_token TEXT NOT NULL DEFAULT '', enabled_at INTEGER NOT NULL);
CREATE TABLE pilot_bot_events (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES pilot_people(id), message_id TEXT NOT NULL REFERENCES pilot_messages(id), created_at INTEGER NOT NULL, push_done INTEGER NOT NULL DEFAULT 0);
CREATE INDEX pilot_idx_bot_events_push ON pilot_bot_events(push_done,created_at);
CREATE TABLE pilot_push_devices (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES pilot_people(id), auth_version INTEGER NOT NULL, subscription TEXT NOT NULL, created_at INTEGER NOT NULL, last_sent INTEGER NOT NULL DEFAULT 0);
CREATE INDEX pilot_idx_push_devices_user ON pilot_push_devices(user_id);
INSERT INTO pilot_people (id,email,name,role,active,joined_at) VALUES ('maintenance-bot','','Maintenance Bot','bot',0,0);

CREATE TABLE IF NOT EXISTS pilot_chat_notification_preferences (user_id TEXT PRIMARY KEY REFERENCES pilot_people(id), auth_version INTEGER NOT NULL, enabled INTEGER NOT NULL DEFAULT 0, enabled_at INTEGER NOT NULL, quiet_start INTEGER NOT NULL DEFAULT 1320, quiet_end INTEGER NOT NULL DEFAULT 420, quiet_enabled INTEGER NOT NULL DEFAULT 0, timezone TEXT NOT NULL DEFAULT 'UTC', muted_rooms TEXT NOT NULL DEFAULT '[]', last_attempt INTEGER NOT NULL DEFAULT 0, lease_until INTEGER NOT NULL DEFAULT 0, lease_token TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS pilot_chat_push_receipts (device_id TEXT NOT NULL REFERENCES pilot_push_devices(id) ON DELETE CASCADE, message_id TEXT NOT NULL REFERENCES pilot_messages(id), created_at INTEGER NOT NULL, PRIMARY KEY(device_id,message_id));
CREATE TABLE IF NOT EXISTS pilot_employee_status (user_id TEXT PRIMARY KEY REFERENCES pilot_people(id), status TEXT NOT NULL CHECK(status IN ('available','working','away','driving')), expires_at INTEGER NOT NULL, auth_version INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS pilot_conversation_preferences (
 user_id TEXT NOT NULL REFERENCES pilot_people(id), room_id TEXT NOT NULL REFERENCES pilot_rooms(id),
 favorite INTEGER NOT NULL DEFAULT 0, section TEXT NOT NULL DEFAULT '',
 notification TEXT NOT NULL DEFAULT 'mentions' CHECK(notification IN ('all','mentions','muted')),
 PRIMARY KEY(user_id,room_id)
);
CREATE TABLE IF NOT EXISTS pilot_saved_messages (
 user_id TEXT NOT NULL REFERENCES pilot_people(id), message_id TEXT NOT NULL REFERENCES pilot_messages(id),
 saved_at INTEGER NOT NULL, PRIMARY KEY(user_id,message_id)
);
CREATE TABLE IF NOT EXISTS pilot_crew_profiles (
 user_id TEXT PRIMARY KEY REFERENCES pilot_people(id), job_title TEXT NOT NULL DEFAULT '',
 photo BLOB, photo_mime TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL DEFAULT 0
);


ALTER TABLE workspace ADD logo_data text;
ALTER TABLE demo_workspace ADD logo_data text;
ALTER TABLE pilot_workspace ADD logo_data text;
ALTER TABLE demo_crew_profiles ADD COLUMN r2_key TEXT;
ALTER TABLE pilot_crew_profiles ADD COLUMN r2_key TEXT;
