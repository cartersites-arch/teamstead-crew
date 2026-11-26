-- Password sign-in: an alternative credential alongside passkeys.
-- Stores only a PBKDF2-SHA256 hash (see lib/passwords.ts); NULL means the
-- person has not set a password. Existing per-company tables (<prefix>people)
-- need the same one-column ALTER when this is deployed per project.
ALTER TABLE `people` ADD COLUMN `password_hash` text;
