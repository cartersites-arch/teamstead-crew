# Monthly pricing update — prepared, not deployed

Live Stripe account acct_1UO4UxF4XZKyCDNw has default monthly prices Chat $15, Maintenance $29, Parts $19, Chat + Maintenance $39, Chat + Parts $29, Maintenance + Parts $39, Complete $49. Annual prices and existing subscriptions are unchanged.

## Production destinations and blocker

Cloudflare account 0e91333c6994f692c3cb0e2d0e0efa02 (Teamstead Software):
- crew-maintenance serves teamsteadcrew.com; canonical deployment inspected: 46a3488f-f416-4c17-9d0d-7e91b6a0833e.
- teamstead-crew serves the app and checkout API; canonical deployment inspected: 5653308c-cc23-4160-ae4f-fc8522b1ae1c.

Both projects use direct uploads with no connected Git source. This repository does not reproduce current production: public /pricing/ and /checkout/ are absent here, and source specifies a 14-day trial while the live public site specifies 30 days. The current public-site deployment file manifest was recovered from the Cloudflare deployment API on October 31. The live backend source/bundle has not been recovered; Workers script/service download attempts returned not-found for the Pages-generated worker. Connected Google Drive searches did not find a Teamstead source archive. The latest backend deployment ZIP/source has not been located. Do not deploy this repository over production wholesale. No production Cloudflare settings or deployments were changed.

## Safe rollout after recovering current source

1. Apply the revised monthly amounts from lib/product-plans.ts to current production source. On the public site update /pricing/index.html, /checkout/index.html (radio choices, default total and renewal sentence), and /checkout/checkout.js (plans object). Change Chat + Parts 39 to 29, Maintenance + Parts 59 to 39, Complete 79 to 49; keep all other prices unchanged. These locations and current values were verified against public files October 30–31, 2026.
2. Apply the legacy-price recognition change in lib/stripe-billing.ts and environment declarations. Preserve the current trial, member limits, assets, authentication, integrations and billing protections.
3. Merge the six non-secret settings in release-patches/production-price-env.json into the teamstead-crew production environment, preserving other settings and secrets. Deploy the legacy-aware application with these settings in one release. Replacing only the three canonical monthly keys could cause existing subscription webhooks to fail validation.
4. Publish the full current public-site artifact with the narrow changes from step 1, preserving other routes, assets, redirects, headers and install configuration.
5. Verify all public plan choices and application billing displays. Check that authorised new checkout sessions reference the new monthly Stripe prices and that signed webhooks for old subscriptions remain accepted. Do not submit a live subscription or charge merely for verification. Keep old prices active until checkout references are accounted for.

Annual prices for the revised bundles remain $390/$590/$790 because annual changes were not authorised. These offer no savings against revised monthly pricing; review before promoting annual savings.

Some Stripe product descriptions specify 15 employees while the live public site specifies 10 active members. No entitlement or description changes were made.

## Validation

TypeScript check, client build and worker build passed in the workspace before it became unavailable. Authenticated checkout and signed webhook tests passed for each changed plan (64 checks each, 192 total), including acceptance of old and new prices and rejection of unknown prices. External Stripe calls were mocked; no live subscriptions were created. The committed code matches those tested changes.

Updated copies of the three live public files were checked locally in Chromium: all seven plan summaries and signup destinations, interactive selection and unchanged 30-day disclosure passed. The workspace recovered on October 31. All three checked replacement files are now preserved in release-patches/public-site/ on this branch.

Tax behaviour is preserved. Registration and collection require separate verification before claiming taxes are configured.
