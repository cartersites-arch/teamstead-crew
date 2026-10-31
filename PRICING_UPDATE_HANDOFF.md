# Monthly pricing update deployed October 30 2026

Approved monthly USD prices are live: Chat $15, Maintenance $29, Parts Finder $19, Chat + Maintenance $39, Chat + Parts $29, Maintenance + Parts $39, Complete $49.

Cloudflare account: `0e91333c6994f692c3cb0e2d0e0efa02`. Stripe account: `acct_1UO4UxF4XZKyCDNw` (Teamstead Software, live).

## Production release

- Public website: https://teamsteadcrew.com, project `crew-maintenance`, deployment `1b0debdc-e086-486b-a02b-b397281ede90`.
- Application and checkout API: https://teamstead-crew.pages.dev, project `teamstead-crew`, deployment `a153f2fd-fd63-4906-a361-fa85d070512c`.
- [Six production settings](release-patches/production-price-env.json) select the three new monthly prices and retain the three previous IDs for subscription webhook validation.

The 30-day trial, ten-active-member policy, annual prices, existing subscriptions, secrets, D1/R2 bindings, compatibility settings and customer data were preserved. No Stripe subscriptions, customers, charges or product settings were changed during this rollout.

## Recovery and reconciliation

Both projects still use direct uploads without connected Git source. The October 27 release folders were recovered locally under `Apps/Teamstead-launch-fixes`. All 33 public-site files and all 30 application asset files matched the previous canonical deployment manifests and fetched public assets. Rebuilding the recovered backend source exactly reproduced its worker artifact: SHA-256 `7c86704a0050c42e3856a75508acc419e23f5da6ac44bd495bb442fe340f877a`.

The prior live worker could not be downloaded directly. Recovery provenance comes from the complete matching release assets, account/project metadata, deployment date and reproducible build. The final worker diff adds only legacy-price recognition. The final browser JavaScript changes only the three monthly amounts. Production CSS and other assets were retained.

This branch includes the newer recovered application source and current trial/member policies. Existing PR tests and unrelated repository files were preserved. Obsolete sandbox utilities and stale source metadata were excluded.

## Exact published artifacts

[Deployment ZIPs](release-patches/deployed-artifacts/) contain the complete directories actually published, including production CSS, headers, all assets and the application worker:

- `teamstead-crew-app-2026-10-30.zip`
- `teamstead-crew-public-2026-10-30.zip`

Extract each ZIP into a separate directory. Rebuilding source can generate different Tailwind CSS; inspect asset differences before a later rollout. The three replacement files in [public-site](release-patches/public-site/) are not a complete website.

Use authenticated Wrangler with the explicit account and project. The app artifact is already bundled: `wrangler pages deploy <app-directory> --project-name=teamstead-crew --branch=main --no-bundle`. Publish the public directory to `crew-maintenance`. Preserve dashboard settings, bindings and secrets.

## Verification

- TypeScript check, client build and worker build passed.
- 489 mocked checkout and cryptographically signed webhook assertions passed across all seven plans: exact production IDs, legacy monthly IDs, unchanged annual prices, unknown/cross-plan/interval rejection, authentication, replay/idempotency protection and the 30-day initial trial.
- Read-only Stripe API checks confirmed all seven monthly prices, seven annual prices and three legacy monthly prices are active in the intended live account.
- Live mobile/desktop browser checks passed for all public pricing/checkout and application signup choices, selected plans, totals, renewal text, destinations and 30-day disclosures.
- All 33 live public files matched the published artifact. App static files matched; protected Parts Finder assets retained deployment hashes and sign-in guards. Dynamic install manifest and security/cache headers passed.
- Exactly six approved price settings changed. Annual IDs, secret bindings, D1/R2 resources and compatibility settings stayed unchanged.

The [verification record](release-patches/verification/production-verification.json) contains deployment IDs and file manifests. Run `node qa/pricing-production.mjs` for the portable mocked billing suite.

Live forms were not submitted. No live checkout session, subscription, charge or signed webhook was created for verification. Authenticated Company Billing was not entered. Checkout ID selection and legacy signed-webhook acceptance were verified with mocked Stripe calls plus the deployed settings.

## Later billing changes

Annual bundle prices remain $390/$590/$790. No annual savings claim was added. Some Stripe descriptions still mention 15 employees while current production permits 10 active members. Product descriptions and tax behavior were outside this update.

A rollback must retain legacy-price support or restore the matching previous environment and release together. Do not deploy a pre-legacy worker with the new canonical price settings.
