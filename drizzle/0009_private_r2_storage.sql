CREATE TABLE r2_objects (app TEXT NOT NULL CHECK(app IN ('chat','maintenance')),object_key TEXT NOT NULL,size INTEGER NOT NULL CHECK(size>0 AND size<=5242880),sha256 TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(app,object_key));
CREATE TRIGGER r2_objects_quota BEFORE INSERT ON r2_objects WHEN NOT EXISTS(SELECT 1 FROM r2_objects WHERE app=NEW.app AND object_key=NEW.object_key) AND (SELECT COALESCE(SUM(size),0) FROM r2_objects WHERE app=NEW.app)+NEW.size>4000000000 BEGIN SELECT RAISE(ABORT,'R2_BUDGET_FULL'); END;
CREATE TABLE r2_daily_operations (day TEXT NOT NULL,kind TEXT NOT NULL,count INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(day,kind));
CREATE TABLE r2_aliases (legacy_key TEXT PRIMARY KEY NOT NULL,object_key TEXT NOT NULL);
ALTER TABLE crew_profiles ADD COLUMN r2_key TEXT;
