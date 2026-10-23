CREATE TABLE `photo_budget` (
	`id` integer PRIMARY KEY NOT NULL,
	`used_bytes` integer DEFAULT 0 NOT NULL,
	`limit_bytes` integer DEFAULT 67108864 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `photo_objects` (
	`object_key` text PRIMARY KEY NOT NULL,
	`size` integer NOT NULL,
	`body` blob NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO photo_budget (id,used_bytes,limit_bytes) VALUES (1,0,67108864);
--> statement-breakpoint
-- The size and quota checks run inside the insertion transaction. Concurrent
-- uploads cannot reserve the same remaining space, and failures roll back.
CREATE TRIGGER photo_objects_validate BEFORE INSERT ON photo_objects
WHEN NEW.size < 1 OR NEW.size > 524288 OR length(NEW.body) <> NEW.size
BEGIN
  SELECT RAISE(ABORT, 'PHOTO_SIZE_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER photo_objects_quota BEFORE INSERT ON photo_objects
WHEN COALESCE((SELECT limit_bytes - used_bytes FROM photo_budget WHERE id = 1), -1) < NEW.size
BEGIN
  SELECT RAISE(ABORT, 'PHOTO_BUDGET_FULL');
END;
--> statement-breakpoint
CREATE TRIGGER photo_objects_account_insert AFTER INSERT ON photo_objects
BEGIN
  UPDATE photo_budget SET used_bytes = used_bytes + NEW.size WHERE id = 1;
END;
--> statement-breakpoint
CREATE TRIGGER photo_objects_account_delete AFTER DELETE ON photo_objects
BEGIN
  UPDATE photo_budget SET used_bytes = used_bytes - OLD.size WHERE id = 1;
END;
--> statement-breakpoint
-- Photo keys are immutable. Replacements get a new key and go through quota
-- validation; message deletion is the only normal route to freeing bytes.
CREATE TRIGGER photo_objects_no_update BEFORE UPDATE ON photo_objects
BEGIN
  SELECT RAISE(ABORT, 'PHOTO_REPLACEMENT_NOT_ALLOWED');
END;
