# Parts Finder — requirements, implementation unverified

Teamstead's commercial Parts Finder is a separate product/module that can connect securely to Teamstead Maintenance and Chat. These requirements are carried forward from project discussions; they do not establish that working code already exists.

Confirmed starting scope:
- Employees submit part requests with descriptions and photographs from phones.
- Requests/photos can be captured offline and synchronize when connectivity returns.
- Phone notifications support request follow-up.
- Searchable purchase history.
- Receipt photographs initially; do not assume receipt OCR or accounting integrations already exist.
- Keep customer companies isolated; connect requests to their own equipment/maintenance context.
- Keep PMS code/data/deployments separate; a future PMS integration must be separate.

Clarify during design: supplier search coverage, availability/price freshness, approval roles, status transitions, notification channel, duplicate handling and purchasing authority. Do not implement automatic purchasing without a separate owner decision.

Suggested first prototype (proposal, not existing behavior): request form, request/status list, and request detail with photos/purchase history. Demonstrate offline synchronization without duplicate requests and cross-company access rejection using two fictional companies.
