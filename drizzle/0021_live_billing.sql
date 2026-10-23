-- Existing workspaces keep their existing free/sandbox access.
ALTER TABLE company_registry ADD COLUMN billing_required INTEGER NOT NULL DEFAULT 0;
ALTER TABLE company_billing ADD COLUMN billing_mode TEXT NOT NULL DEFAULT 'test';
