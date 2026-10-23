# Independent Project Room local checks

Run from the project directory with its installed dependencies and Node 22.13 or later (recorded run: Node 24):

```sh
node qa/independent-passkey-integration.mjs
node qa/independent-miniflare.mjs
```

Neither script deploys or accesses a Cloudflare account. They create synthetic people, passkeys, messages and photos in temporary databases. Do not use live credentials or live database bindings with these scripts. The first rejects global outbound fetches; the second explicitly blocks outbound services in its local Workers runtime.

`independent-passkey-integration.mjs` bundles the actual Worker, request context, route handlers, WebAuthn verifier and D1 photo store. It runs all actual SQL migrations against Node SQLite behind a D1-shaped adapter. A software authenticator creates real P-256 registration data and signed assertions. Public assets use a fixture binding.

The checks cover setup-only and full session scopes, cookie/header identity binding, origin/RP/challenge/UV/user-handle checks, registration and recovery races, reauthentication, device revocation, room/DM/search/photo isolation, security and AI controls, actual asynchronous request-context isolation, Worker routing and body limits, the 512 KiB object limit and atomic 64 MiB photo budget, durable deletion retries and pre/post-commit failures. Synthetic quota tests fill the actual 64 MiB budget, then delete their fixtures. The 30-job cleanup test verifies progress over bounded requests and records observed SQL statements per request.

`independent-miniflare.mjs` independently exercises the actual D1 BLOB boundary in a local Workers runtime. Its report describes the narrower checks performed there.

Results are written to `independent-results.json` and `independent-miniflare-results.json`, including source hashes. Files with other result names predate the independent host and are historical only.

These are local integration checks, not a comprehensive security audit. Software assertions do not establish physical-device passkey enrollment or recovery behavior. Node timing does not establish compliance with the production Free Worker 10 ms CPU limit. No tests claim to validate deployed accounts, billing controls, live asset routing, actual mobile browsers, or production request limits.
