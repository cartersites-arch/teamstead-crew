# Verified live Stripe prices — October 30, 2026

Account: acct_1UO4UxF4XZKyCDNw. These are configuration references, not credentials. Live Stripe product defaults have been updated. Website deployment remains pending reconciliation with the latest production source.

| Plan | Monthly USD | Monthly price ID | Annual USD | Annual price ID |
| --- | ---: | --- | ---: | --- |
| Chat Only | 15 | price_1UOCm8F4XZKyCDNwA18W0pGX | 150 | price_1UOCm8F4XZKyCDNwToTYl1VI |
| Maintenance Hub Only | 29 | price_1UOCm8F4XZKyCDNwtQtIoudV | 290 | price_1UOCm8F4XZKyCDNwvaXKm4pN |
| Chat + Maintenance Hub | 39 | price_1UOCmDF4XZKyCDNwULoIReRh | 390 | price_1UOCmCF4XZKyCDNwoSCnEhVy |
| Parts Finder Only | 19 | price_1UTPR1F4XZKyCDNw1q16W44H | 190 | price_1UTPRPF4XZKyCDNwdSA8l3qG |
| Chat + Parts Finder | 29 | price_1UWPdyF4XZKyCDNw40TlAMR8 | 390 | price_1UTPU7F4XZKyCDNwvVz1oxMq |
| Maintenance Hub + Parts Finder | 39 | price_1UWPe3F4XZKyCDNwhCrV364H | 590 | price_1UTPWJF4XZKyCDNwY8nEDYk4 |
| Complete suite | 49 | price_1UWPe8F4XZKyCDNw1u1ORCHn | 790 | price_1UTPXmF4XZKyCDNwEM4CekqO |

All seven products are Active with monthly and annual prices. One duplicate Chat + Parts annual price was archived after a transient dashboard error; the active price ID is listed above. No subscriptions or payments were created during verification.

Before broad paid launch: confirm tax requirements, Radar settings, and signed live webhook delivery with an end-to-end checkout test.

Annual prices and existing subscriptions are unchanged. Previous monthly prices remain active until checkout references are migrated safely. Deploy legacy-price recognition before replacing production monthly checkout settings; otherwise subscription webhooks on the old prices may fail validation. See PRICING_UPDATE_HANDOFF.md.
