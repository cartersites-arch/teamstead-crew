CREATE TABLE IF NOT EXISTS product_identity (
  id INTEGER PRIMARY KEY CHECK(id=1),
  product TEXT NOT NULL,
  database_id TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);
INSERT INTO product_identity(id,product,database_id,active)
VALUES(1,'teamstead-sales','24543c2f-3d1f-4313-b46f-0708b6db28a1',1)
ON CONFLICT(id) DO UPDATE SET
  product=excluded.product,
  database_id=excluded.database_id,
  active=excluded.active;
