-- Add the sellable Parts Finder product without rebuilding the existing registry table.
-- The legacy product_plan column remains for rollback compatibility.
ALTER TABLE company_registry ADD COLUMN product_bundle TEXT NOT NULL DEFAULT 'combined'
  CHECK(product_bundle IN ('chat','hub','parts','combined','complete'));
UPDATE company_registry SET product_bundle=product_plan;
UPDATE company_registry SET product_bundle='complete' WHERE id IN ('main','demo','pilot');
