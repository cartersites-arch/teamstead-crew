CREATE TABLE company_registry(id TEXT PRIMARY KEY,name TEXT NOT NULL,owner_id TEXT NOT NULL,status TEXT NOT NULL,created_at INTEGER NOT NULL,setup_hash TEXT,setup_expires INTEGER NOT NULL DEFAULT 0,setup_cursor INTEGER NOT NULL DEFAULT 0,signup_key TEXT UNIQUE,hub_ready INTEGER NOT NULL DEFAULT 0);
INSERT INTO company_registry(id,name,owner_id,status,created_at,hub_ready) SELECT 'main',name,owner_id,'active',created_at,1 FROM workspace WHERE id='main';
INSERT INTO company_registry(id,name,owner_id,status,created_at,hub_ready) SELECT 'demo',name,owner_id,'active',created_at,1 FROM demo_workspace WHERE id='main';
INSERT INTO company_registry(id,name,owner_id,status,created_at,hub_ready) SELECT 'pilot',name,owner_id,'active',created_at,1 FROM pilot_workspace WHERE id='main';
CREATE TABLE signup_limits(ip_hash TEXT NOT NULL,day TEXT NOT NULL,count INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(ip_hash,day));
CREATE TABLE platform_settings(id INTEGER PRIMARY KEY CHECK(id=1),signup_enabled INTEGER NOT NULL DEFAULT 1,company_limit INTEGER NOT NULL DEFAULT 10);
INSERT INTO platform_settings(id) VALUES(1);
CREATE TABLE company_member_links(company TEXT NOT NULL,user_id TEXT NOT NULL,hub_role TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',request_key TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(company,user_id),UNIQUE(company,request_key));
