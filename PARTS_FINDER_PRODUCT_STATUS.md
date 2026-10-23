# Teamstead Parts Finder product status

Parts Finder is a Teamstead-authenticated product available in seven company packages:

- `chat`: Crew Chat by itself.
- `hub`: Maintenance Hub by itself.
- `parts`: Parts Finder by itself.
- `combined`: Chat and Maintenance Hub.
- `chat_parts`: Chat and Parts Finder.
- `hub_parts`: Maintenance Hub and Parts Finder.
- `complete`: Chat, Maintenance Hub and Parts Finder.

Company invitations make every active employee, shop worker and manager eligible for every product in the company plan; Parts Finder has no manager-only gate.

## Security and access

- `/parts/` and all `/api/parts-*` routes require a valid Teamstead session.
- The company subscription and product entitlement are checked before Parts Finder content or search endpoints are served.
- The SerpApi key remains server-side in the encrypted `SERPAPI_API_KEY` Cloudflare setting.
- GPS is permitted only for the protected Parts Finder page and is not stored by the app.
- The original ChatGPT Sites pilot remains private and is not used as the employee access boundary.

## Billing status

Live monthly and annual Stripe prices were created for all Parts Finder packages on October 22, 2026. The seven public plan choices can be deployed after the new Cloudflare variables and the `product_package` database migration are in place.

Required settings:

- `STRIPE_PRICE_PARTS_MONTH`
- `STRIPE_PRICE_PARTS_YEAR`
- `STRIPE_PRICE_CHAT_PARTS_MONTH`
- `STRIPE_PRICE_CHAT_PARTS_YEAR`
- `STRIPE_PRICE_HUB_PARTS_MONTH`
- `STRIPE_PRICE_HUB_PARTS_YEAR`
- `STRIPE_PRICE_COMPLETE_MONTH`
- `STRIPE_PRICE_COMPLETE_YEAR`
- `SERPAPI_API_KEY`
