ALTER TABLE company_billing ADD COLUMN payment_failed_at INTEGER;
ALTER TABLE company_billing ADD COLUMN trial_ends_at INTEGER;
ALTER TABLE company_billing ADD COLUMN cancel_at_period_end INTEGER NOT NULL DEFAULT 0;
