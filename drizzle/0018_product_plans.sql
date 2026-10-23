ALTER TABLE company_registry ADD COLUMN product_plan TEXT NOT NULL DEFAULT 'combined' CHECK(product_plan IN ('chat','hub','combined'));
