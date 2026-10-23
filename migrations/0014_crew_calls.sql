CREATE TABLE IF NOT EXISTS crew_call_peers (
 company_id TEXT NOT NULL, room_id TEXT NOT NULL, user_id TEXT NOT NULL,
 peer_id TEXT NOT NULL UNIQUE, auth_version INTEGER NOT NULL,
 joined_at INTEGER NOT NULL, seen_at INTEGER NOT NULL,
 PRIMARY KEY(company_id,room_id,user_id)
);
CREATE INDEX IF NOT EXISTS crew_call_presence ON crew_call_peers(company_id,room_id,seen_at);
CREATE TABLE IF NOT EXISTS crew_call_signals (
 id INTEGER PRIMARY KEY AUTOINCREMENT, company_id TEXT NOT NULL,
 room_id TEXT NOT NULL, sender TEXT NOT NULL, target TEXT NOT NULL,
 payload TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS crew_call_inbox ON crew_call_signals(company_id,room_id,target,id);
CREATE INDEX IF NOT EXISTS crew_call_expiry ON crew_call_signals(created_at);
