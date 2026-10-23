CREATE TABLE bot_preferences (user_id TEXT PRIMARY KEY REFERENCES people(id), enabled INTEGER NOT NULL DEFAULT 0, auth_version INTEGER NOT NULL, connection_iv TEXT NOT NULL, room_id TEXT NOT NULL UNIQUE REFERENCES rooms(id), actor_id TEXT, snapshot TEXT NOT NULL DEFAULT '[]', last_attempt INTEGER NOT NULL DEFAULT 0, last_checked INTEGER NOT NULL DEFAULT 0, last_error TEXT NOT NULL DEFAULT '', lease_until INTEGER NOT NULL DEFAULT 0, lease_token TEXT NOT NULL DEFAULT '', enabled_at INTEGER NOT NULL);
CREATE TABLE bot_events (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES people(id), message_id TEXT NOT NULL REFERENCES messages(id), created_at INTEGER NOT NULL, push_done INTEGER NOT NULL DEFAULT 0);
CREATE INDEX idx_bot_events_push ON bot_events(push_done,created_at);
CREATE TABLE push_devices (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES people(id), auth_version INTEGER NOT NULL, subscription TEXT NOT NULL, created_at INTEGER NOT NULL, last_sent INTEGER NOT NULL DEFAULT 0);
CREATE INDEX idx_push_devices_user ON push_devices(user_id);
INSERT INTO people (id,email,name,role,active,joined_at) VALUES ('maintenance-bot','','Maintenance Bot','bot',0,0);
