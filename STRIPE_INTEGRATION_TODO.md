# Stripe sandbox integration status

Updated 2026-10-07. Deployed to https://project-room-ekn.pages.dev/. Sandbox only; real payments are disabled.

## Completed

- Owner-only billing page at /billing/, linked from company administration.
- Three company products: Chat Only ($15/month or $150/year), Hub Only ($29/month or $290/year), and Chat + Hub ($39/month or $390/year).
- Company plan, price and quantity (one company) are selected on the server.
- Checkout attempts and customer/subscription status persist in D1, with idempotent checkout creation.
- Signature-verified, duplicate-safe Stripe notifications reconcile canonical subscription status. A browser return URL cannot activate a subscription.
- Sandbox secret key and webhook signing secret stored as encrypted production settings in Cloudflare project-room. No secrets stored in this document.
- Active Stripe destination: we_1UOAxbFE3UvQ6SNinQbM8BCp, https://project-room-ekn.pages.dev/api/stripe-webhook. Nine checkout, subscription and invoice events; API version 2026-08-26.dahlia.
- Final package deployment visibly confirmed successful in Cloudflare after saving both credentials.
- Deployed PMS billing page reads status through the API and confirms that existing PMS/demo/legacy pilot workspaces are not billed.
- Chat-only membership revocation does not call the Hub. Hub-only invitations require Hub access.

## Sandbox prices

Account: acct_1UO4VCFE3UvQ6SNi (Teamstead Software sandbox).

| Binding | Price ID |
|---|---|
| STRIPE_PRICE_CHAT_MONTH | price_1UOAZdFE3UvQ6SNipIVWaJ6j |
| STRIPE_PRICE_CHAT_YEAR | price_1UOAaeFE3UvQ6SNiX2RdSa25 |
| STRIPE_PRICE_HUB_MONTH | price_1UOAcwFE3UvQ6SNiLPPEYdzR |
| STRIPE_PRICE_HUB_YEAR | price_1UOAdIFE3UvQ6SNipvw04CKM |
| STRIPE_PRICE_COMBINED_MONTH | price_1UOAXrFE3UvQ6SNi4y5nwwLK |
| STRIPE_PRICE_COMBINED_YEAR | price_1UOAXrFE3UvQ6SNi7wt5LrL1 |

All six amounts verified in Stripe and saved as Cloudflare Text settings. Return URLs are generated on the server for the current company; STRIPE_SUCCESS_URL/STRIPE_CANCEL_URL are not needed.

## Database rollout

Applied manually in the Cloudflare D1 console to pms-crew:
- company_registry.product_plan additive column from migration 0018
- company_billing and stripe_billing_events tables from migration 0019

Pre-change recovery bookmark: 0000000c-000002d6-000050fe-b4a935701456971d10abe50faeaed443.
The manual changes are not recorded in a migration ledger. Do not blindly reapply the ALTER TABLE. Check schema and reconcile the ledger before switching to automated migrations.

## Validation

- TypeScript check, app build and Worker build passed.
- Checkout/webhook QA: 41 assertions passed using simulated Stripe responses, including invalid signatures, duplicate and stale events, incorrect subscription quantity, failed payments, cancellation and annual restart.
- Product-plan QA: 100 assertions passed.
- Company deletion QA: 75 assertions passed.
- Deployed billing page/API smoke check passed for existing PMS owner context.
- End-to-end sandbox checkout PASSED for Chat + Hub monthly ($39), company c_3e9023cf021a4b92 (Stripe Test Company). Used synthetic test card 4242 and stripe-test@example.com. App status became active. checkout.session.completed, customer.subscription.created and invoice.paid each delivered HTTP 200; zero failed deliveries. Subscription sub_1UOB5lFE3UvQ6SNif1T2bXEB, customer cus_VOz36q0OlAmxZJ. Sandbox customer portal opened successfully and showed the paid test invoice. No real payment collected.

## Next steps before real sales

1. Initial combined monthly checkout, webhook reconciliation and portal opening are verified. Retain Stripe Test Company for further tests; its sandbox subscription is active. Never use real cards in the sandbox.
2. Test all six price options, payment failure, cancellation and company isolation end to end.
3. Sandbox customer portal opening verified. Cancellation, failed renewals and all remaining price options still need end-to-end testing before live launch.
4. Decide and implement paid access rules, trial/grace periods and plan-change policy. Workspaces currently remain available during testing regardless of subscription status. This is not yet an enforced paid service.
5. Complete live Stripe activation and bank verification, resolve tax requirements, and publish terms, privacy and cancellation/refund policies. Automatic Tax remains disabled to match the draft; that does not establish tax exemption.
6. Create live prices separately and deliberately enable live keys only after fulfillment and purchase-flow verification. The current code rejects live keys and live Checkout sessions.
7. Public crew-maintenance.pages.dev has not been changed in this rollout. Connect its purchase entry points only after the owner checkout flow is verified.

## Implementation

Files: app/api/checkout/route.ts, app/api/stripe-webhook/route.ts, app/billing-page.tsx, lib/stripe-checkout.ts, lib/stripe-billing.ts, drizzle/0019_company_billing.sql, migrations/0019_company_billing.sql and qa/stripe-checkout.mjs. Routes registered in worker/index.ts; bindings typed in cloudflare-env.d.ts.

Uses Stripe REST in the existing Cloudflare Worker, without adding Express or a Stripe SDK. Checkout is hosted by Stripe; payment card data never passes through our app server.


## Expanded test run — 2026-10-07

- Automated route tests now accept chat, hub or combined as an argument. All three runs passed 41 checks each (123 checks), covering monthly/yearly server price selection, cancellation/restart, duplicate checkout prevention, wrong signatures, stale/replayed events, failed subscription status and quantity validation. Stripe responses are simulated in these automated tests.
- Combined monthly ($39) and annual ($390) browser checkouts passed in the real Stripe sandbox. Both reconciled active via the deployed webhook.
- Customer-portal cancellation at period end succeeded; immediate dashboard cancellation also succeeded and reconciled canceled in the app. Then the app allowed a new annual checkout.
- Annual checkout with synthetic declined card 4000000000000002 showed the expected decline; replacing it with 4242 completed payment and reconciled active. This tests an initial payment decline, not a future failed renewal.
- Current combined test company c_3e9023cf021a4b92 now has an active annual sandbox subscription; its original monthly subscription is canceled.
- Four standalone browser checkout tests remain pending owner passkeys: Chat Only monthly/yearly and Hub Only monthly/yearly. Signup forms prepared as Stripe Chat Test and Stripe Hub Test. User agreed to create their passkeys.
- Observed cached /signup/ document served old product-selection UI; a fresh query /signup/?billing-test=20261007 served current product selector and asset bundle. Add appropriate HTML cache policy before launch; no production headers changed during this test run.

### Chat Only browser tests - 2026-10-08
- Company c_f2cb8c1ec4584d18 (Stripe Chat Test): monthly USD15 checkout succeeded; app active confirmed through Stripe notifications.
- Monthly sub_1UOBRBFE3UvQ6SNiBwfoCfBf canceled immediately in sandbox, no refund; app canceled confirmed.
- Yearly USD150 checkout succeeded; app active confirmed. Session cs_test_a1sErtPoCSn92z9h36UmUTvFrh58UAow6OQx0IMndp2C2HoYHbhgTfEKmZ.
- Chat Only sidebar has no Maintenance button.
- Hub Only signup prepared; user must create its owner passkey before the two remaining checkout tests.


### Hub Only browser tests - 2026-10-08
- Company c_4cb8aed4d6304970 (Stripe Hub Test) created with owner passkey by user. Home shows Maintenance Hub without chat channels.
- Monthly USD29 checkout succeeded; app active confirmed through Stripe notifications. Session cs_test_a1WVHl7uRhDXSmkK4ga2mUzaVLaTiMqO9FGctAwBcPCcl8aEfpt0frkF8v.
- Monthly sub_1UOBd4FE3UvQ6SNiW44Upe9Q canceled immediately in sandbox, no refund; app canceled confirmed.
- Yearly USD290 checkout submitted; verifying status.

- Yearly USD290 checkout succeeded; app active confirmed through Stripe notifications. Session cs_test_a11qvAgyZhEtRAMHPnagL6G5crnj7I8KJYUUUjEPe9sP38w78FVQnG02Iq.
- All six initial sandbox hosted checkout flows now verified in browser. Failed recurring renewal remains untested; synthetic automated past_due checks pass. Real payments remain disabled.

