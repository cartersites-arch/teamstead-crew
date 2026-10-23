-- Keep the older constrained product_bundle column for rollback compatibility.
-- product_package is the sellable seven-plan identity used by the application.
ALTER TABLE company_registry ADD COLUMN product_package TEXT
  CHECK(product_package IS NULL OR product_package IN ('chat','hub','parts','combined','chat_parts','hub_parts','complete'));
UPDATE company_registry SET product_package=product_bundle WHERE product_package IS NULL;
