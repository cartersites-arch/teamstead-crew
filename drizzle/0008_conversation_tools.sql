CREATE TABLE IF NOT EXISTS conversation_preferences (
 user_id TEXT NOT NULL REFERENCES people(id), room_id TEXT NOT NULL REFERENCES rooms(id),
 favorite INTEGER NOT NULL DEFAULT 0, section TEXT NOT NULL DEFAULT '',
 notification TEXT NOT NULL DEFAULT 'mentions' CHECK(notification IN ('all','mentions','muted')),
 PRIMARY KEY(user_id,room_id)
);
CREATE TABLE IF NOT EXISTS saved_messages (
 user_id TEXT NOT NULL REFERENCES people(id), message_id TEXT NOT NULL REFERENCES messages(id),
 saved_at INTEGER NOT NULL, PRIMARY KEY(user_id,message_id)
);
CREATE TABLE IF NOT EXISTS crew_profiles (
 user_id TEXT PRIMARY KEY REFERENCES people(id), job_title TEXT NOT NULL DEFAULT '',
 photo BLOB, photo_mime TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL DEFAULT 0
);
