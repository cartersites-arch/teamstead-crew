# Teamstead Crew

**Status:** Teamstead Crew is deployed at https://teamstead-crew.pages.dev on Cloudflare. The live home screen, signed-in owner workspace and maintenance-bot settings have been inspected. A phone notification test was reported successful by the owner. Broad crew adoption, production backup restoration, load testing and an independent security audit remain unverified.

This version uses React, a plain Cloudflare Worker, and a company-owned D1 database. Running it requires no ChatGPT account, subscription, API key, Sites service, or OpenAI runtime. Optional personal-AI shortcuts remain ordinary links that people choose to open.

A private company workspace with chat, maintenance, parts finding, direct messages, threads, photos, and employee access. It is designed for desktop and mobile web browsers.

## Getting started

1. Jerry opens his private owner setup invitation and creates a passkey with a supported phone, computer, or security key. No ChatGPT account or extra password is required.
2. In **Security & privacy**, add a backup passkey that remains available if the main device is lost.
3. In **People**, create Derek's invitation, choose his channels, and give his setup link to him privately. Invitations last seven days. Nobody is invited or messaged automatically.
4. Each person can add their original personal Maintenance Hub link once under **Maintenance**. The saved button then opens that same Hub access from their signed-in devices.
5. After setup, use **Sign in with passkey** at the normal Project Room address. A used invitation cannot sign someone in by itself.

## Current features

- Passkey sign-in, expiring one-time enrollment links, owner-assisted recovery for other members, and secure seven-day browser sessions.
- Security screen for passkey names/removal, active browser sessions, remote session sign-out, connected Maintenance status, workspace AI permission, pending photo deletions, and recent security history.
- Private and workspace-wide channels, direct messages, replies, search, pins, reactions, own-message editing/deletion, and up to three photos per message. Original JPG, PNG, or WebP inputs may be up to 5 MB; the browser prepares JPEG uploads no larger than 512 KiB, at a maximum dimension of 1600 pixels. Small GIFs retain animation; GIFs over 512 KiB are rejected clearly. The whole pilot shares a 64 MiB photo allowance.
- Responsive mobile navigation and composer, with a home screen for chat, Maintenance Hub, maintenance bots and app shortcuts. Chat updates poll every five seconds while visible; other workspace views poll every thirty seconds. Install metadata supports browser app installation or a phone Home Screen icon where supported. An offline screen gives reconnect guidance. Opt-in maintenance bots support private job updates, daily overdue reminders and generic phone push alerts; separate opt-in chat alerts cover unread direct messages and full-name mentions. There are no native App Store packages or offline sending in this release.
- Optional **My AI** copy-and-open shortcuts for ChatGPT, Claude, and Gemini. The app removes detected private links/common credential patterns, shows the copy preview, and requires explicit review before copying. No provider account is connected, no AI API is called, and no conversation history is sent automatically.

## Privacy boundaries

The entry page is publicly reachable and contains only the app shell. It contains no workspace data. Chat, directory, photo, Maintenance, security, and AI-context endpoints require Project Room's own full passkey-authenticated session.

An invitation permits only passkey setup. Setup sessions expire after 15 minutes and cannot open protected areas. Initial invitations expire after seven days; recovery invitations for already-enrolled members expire after 24 hours. D1 stores SHA-256 hashes of invitation and session credentials. URL fragments are removed from the visible entry URL. Raw invitation links are shown only at their deliberate creation/handoff point, and are not included in audit events.

Passkey challenges are random, browser-bound, purpose-bound, single-use, and expire after five minutes. Registration and sign-in use the real SimpleWebAuthn verifier with the configured HTTPS origin and relying-party hostname, required user verification, opaque user handles, and no identifying attestation. Server checks bind the credential to its account. Enrollment, authentication, and security mutations recheck account/session validity when their database transaction commits.

Session cookies use Secure, HttpOnly, SameSite=Lax, and a __Host- prefix. Each browser document binds API requests to the person it displayed. Cross-account entry reloads the document, and a different person's invitation asks before switching. Mutations reject cross-site origins. Sensitive People, passkey, session, channel-permission, and Maintenance-connection changes require a passkey verification within the preceding five minutes. That recent verification applies to the current session only.

A session sign-out does not remove a passkey: someone who still has a valid passkey can sign in again. If a device is lost, remove its passkey when applicable and sign out its browser sessions. Synced passkeys may be available on more than one device. The last passkey cannot be removed through the app; add a backup first.

The owner can reset another person's account. Recovery removes that person's passkeys, sessions, old invitations, and pending ceremonies, then issues an expiring setup invitation and records the action. It never re-enables permanent bearer-link login. This is a powerful owner privilege: the owner could use a recovery link to assume that account. Logs make this visible but do not eliminate trust in the owner. Owner self-reset through People is disabled; the owner needs a backup passkey, or separately authorized operator-level recovery if every passkey is lost.

Room membership restricts access within the application. Adding someone to a channel gives access to its earlier history; workspace-wide channels also include future members. Active members can see the active people directory. Messages and photos are **not end-to-end encrypted** and are accessible to authorized infrastructure operators. This is not an operator-blind communications system.

Security history shows the latest 50 relevant events to ordinary members and the latest 50 workspace events to the owner. Entries contain action, actor, target, and time, without message contents, stored Hub credentials, or session hashes. Some entries accurately describe a requested security operation, including a failed last-passkey removal. These logs are not immutable against an infrastructure operator. No audit-retention purge schedule has been added.

Exchange and passkey endpoints have a per-worker, per-IP burst limiter. It is not a distributed abuse-prevention service. This pilot should receive independent security review and real-device testing before broader use with sensitive business information.

## Maintenance connection

Accepted origins are exactly:

- https://pms-maintenance-hub-test.pages.dev
- https://pms-maintenance-hub.pages.dev

A complete personal link includes its original `#hub=` credential. Links are encrypted using AES-GCM with a random IV and the person's ID as authenticated additional data. Ordinary responses expose only connected status, environment, and connection time. The launch route checks the signed-in account and expected viewer before decrypting and redirecting to the external Hub.

Connecting validates the format and approved destination. The existing Hub validates the credential when opened. When explicitly enabled, maintenance bots read scoped jobs through the Hub's permission-checked read endpoint and bind the bot connection to the returned Hub actor. Changing the saved connection pauses bots until they are enabled again. Project Room does not change Hub permissions or rebuild its backend. Membership in chat does not grant manager privileges in the Hub.

Original employee links continue to work. Removing a Project Room member deletes the saved Hub association and their Project Room access, but does not revoke the original Hub credential or sign out the Hub. Complete offboarding requires the Hub administrator to revoke its access separately.

## Photos, deletion, and AI

Photos are held as private D1 BLOBs and served only to permitted conversation members. Each stored object is limited to 512 KiB, and database triggers enforce a shared 64 MiB quota atomically. Photo replacement cannot bypass the quota. A quota error keeps the draft and explains how to free space; it does not activate a paid storage service. This photo budget does not cap message text, security history, database indexes, traffic, or CPU time. Deleting a message atomically blanks its body, preserves the thread tombstone, removes attachment metadata/reactions, and creates durable file-deletion jobs. Photo-byte deletion follows that committed transaction and frees the quota when it succeeds. Failed/uncertain cleanup remains queued; Security & privacy offers a retry for the requester or workspace owner. Each request handles up to eight queued photos to leave room within the free database query limit; repeat the action if more remain. Normal message deletion attempts cleanup immediately. This release has no automatic background cleanup schedule, and pending jobs remain until retried.

Deleted message IDs remain so retrying an earlier send cannot resurrect the message and replies retain their structure. Thread replies are not deleted with their parent. Files already downloaded/copied elsewhere cannot be recalled. Browser resizing normally re-encodes JPG/PNG/WebP as JPEG. Do not rely on this as complete metadata scrubbing: GIFs are retained, and direct API uploads can still contain metadata. No age-based message retention policy, complete account-data purge, or guaranteed backup-erasure schedule is implemented.

The AI draft stays in page memory. Only the provider preference is stored locally; AI draft text is not persisted by this feature. Copying checks the current workspace AI permission and uses the displayed sanitized preview. Message-based AI context is authorized on the server against current membership. Disabling shortcuts hides the app's AI entry points and clears the active AI draft when the setting is received.

Sanitization is a best-effort aid, not a comprehensive secret detector. It detects common private URL parameters, encoded/nested links, common labeled/JSON/environment credentials, Bearer values, and distinctive API-key prefixes. Adjacent URLs without whitespace may be removed together as one item. People must review personal and business information before copying. Text pasted into another AI is subject to that provider's settings and retention rules. Disabling the shortcut cannot prevent manual copying or screenshots, and clearing the draft cannot erase an external copy.

## Hosting, limits, and ownership

Use a **new, dedicated** Cloudflare Worker and D1 database in a company-controlled account. Keep that account on Workers Free for the intended $0 hosting pilot. Cloudflare account ownership, billing eligibility, available capacity, and deployed performance still need confirmation. This package cannot guarantee a provider's future terms or enforce the billing plan of an account that an administrator changes later.

No R2 bucket, paid AI API, SMS provider, external connector, paid domain purchase, or paid-plan upgrade is included. A free provider address can be used for the pilot; an existing company-domain subdomain is another option after its routing is configured. Company production use should use a stable company-controlled hostname. Choose the final hostname **before** registering passkeys.

As checked on October 6, 2026, official limits include:

| Resource | Workers / D1 Free limit |
| --- | --- |
| Worker requests | 100,000 per account per day |
| Worker CPU | 10 ms per request |
| D1 queries | 50 per Worker invocation |
| D1 daily rows | 5 million read; 100,000 written |
| D1 database storage | 500 MB per database; 5 GB total account storage |
| D1 row / BLOB | 2,000,000 bytes |
| This app's photo limits | 512 KiB per photo; 64 MiB shared photo bytes |

Free limits are shared with other workloads in the account where applicable. Daily free-limit exhaustion can interrupt the app; it does not automatically purchase a paid plan. The photo cap is only a photo cap, not a guarantee that all database usage stays below the account limits. Two people do not by themselves prove that CPU and query limits will be met. Measure actual passkey, upload, and chat usage on the selected Free account before a wider rollout.

Official references:

- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/d1/platform/limits/
- https://developers.cloudflare.com/workers/configuration/routing/workers-dev/
- https://developers.cloudflare.com/r2/get-started/ (why R2 billing enrollment was omitted)

## Build and run locally

Use Node 24 and pnpm 11.25 or a compatible toolchain. All source, dependency lockfiles, styles, and build scripts are included. There is no requirement to use a ChatGPT development environment.

```sh
pnpm install --frozen-lockfile
pnpm run check
pnpm run build
pnpm run build:worker
pnpm run db:migrate:local
pnpm run start
```

`build:worker` uses esbuild for **local compilation only**. It does not call Wrangler deployment, contact a hosting account, upload the application, or send deployment telemetry. `start` is a local Wrangler development server and uses the local database. Local sign-in tests need test configuration and a secure origin. Production passkey checks intentionally require the configured HTTPS origin; do not weaken that check to make a local preview appear to work.

The production static app lives in `dist/client/`. The independently compiled API lives in `dist/worker/index.js`. Serving only the static directory cannot provide chat or sign-in; it also needs the Worker and database bindings. The package's API router sends `/api/*` and `/maintenance/open` through authorization before any SPA fallback. Unknown API routes and unsupported methods return API errors.

The service worker caches **only** the generic offline page. It never caches private API responses, photographs, authenticated page responses, or drafts, and never queues background sends. The app still needs internet to load current conversations or send messages. Installation support must be checked on Jerry's iPhone and Derek's actual devices.

## First deployment to a new company account

These steps are for an authorized operator after the company account and Free plan have been confirmed. They have not been run remotely for this package.

1. Sign into the intended Cloudflare account using its normal account flow. Choose an unused Worker name and create a new D1 database with the same name, `project-room-company` (or another dedicated `project-room-…` name). Let the deployment helper create the new Worker; it intentionally refuses to overwrite a pre-existing Worker on its first run. Do not reuse a Maintenance Hub database, project, or deployment.
2. Record the actual account ID, new database ID, and intended canonical HTTPS origin. A free `workers.dev` address depends on the real account subdomain; do not guess it. Custom-domain routing must be configured separately if chosen.
3. Configure the package with those non-secret identifiers:

   ```sh
   pnpm run configure --account YOUR_ACCOUNT_ID --database YOUR_NEW_DATABASE_ID --origin https://YOUR_CANONICAL_HOSTNAME
   ```

   Use `--name` as well if a different dedicated `project-room-…` name was created. The origin must contain no path, query, or fragment. `configure` changes local configuration only.
4. Immediately before initial publication, run `pnpm run keys:create`. It generates the high-entropy owner setup grant and a 32-byte Hub encryption key in the ignored `.secrets/` directory. It does not print the private owner link or encryption key into logs. Keep a secure backup of `.secrets/runtime.json`; losing its encryption key prevents opening stored Hub connections.
5. With the confirmed account signed in, run `pnpm run deploy`. The deployment helper validates the destination, checks the actual remote database name and ID and the Worker name, refuses an unrecognized existing Worker or populated workspace, creates a private local database export, applies migrations to that dedicated database, sets secrets, and deploys the Worker/static app. It neither selects nor upgrades the account's billing plan. A failed step stops later steps.
6. Use the actual deployment URL reported by Cloudflare. Jerry opens the private link in `.secrets/owner-setup.txt`, creates a passkey, adds a backup, and then creates Derek's invitation. First-time owner setup expires after seven days. Share each person's link only with that person.
7. Check two real signed-in users, private conversations, a photo upload and deletion, and each person's original Maintenance Hub access. Inspect the provider's CPU/request and database usage. Keep the previous published version available until migration and pilot checks are complete.

Never commit or share `.secrets/`, `.dev.vars`, database exports, or live runtime credentials. The source package contains no live owner link or runtime secret. `keys:create` keeps an existing key file rather than regenerating it, and subsequent deployments check a local destination/key fingerprint to prevent accidental changes. If those private files are lost, follow a deliberate recovery procedure rather than generating a replacement key for a populated database.

## Moving existing data from the prior hosted version

**No live account data, history, photos, or saved Hub connections have been migrated by creating this package.** The current hosted app and existing Maintenance Hub were not modified.

A hostname change is an authentication migration, not just a DNS edit. Passkeys registered for the old hostname cannot sign into an unrelated new hostname. An imported owner would be locked out if only the origin settings changed, because its existing owner record is already enrolled and cannot self-reset through People.

Before transferring a populated workspace:

- Export and preserve its database, original photos, deployment settings, and the exact `MAINTENANCE_LINK_KEY` through an authorized channel. Keep the previous deployment for recovery until the transfer is accepted.
- Preserve person IDs, memberships, message IDs, thread relationships, and attachment IDs. Hub encryption uses each person's ID as authenticated additional data, so the same key alone is insufficient if IDs change.
- Clear old sessions and pending passkey challenges in the new environment. Prepare fresh, short-lived enrollment/recovery access for the owner and each member, and verify it on the final hostname. Do not attempt to reopen permanent bearer-link login.
- Copy actual photo bytes, not just attachment metadata. Prior 5 MB objects may need approved resizing to fit the new 512 KiB limit; retain originals in the migration backup and update MIME/size metadata consistently.
- Reconcile old R2 deletion jobs separately. A missing object in the new D1 store does not prove that its previous R2 copy has been deleted.
- Use either a schema-aware full import or a clean schema plus data import. Do not blindly rerun old schema-creation migrations on top of an existing schema dump.
- If the Hub encryption key cannot be transferred, have each person reconnect their original employee link; those original Hub links still belong to and are validated by the existing Hub.

The first-deployment helper deliberately blocks a populated destination it does not recognize. A real migration must be prepared against the actual source data and verified before the old app is retired. This package does not silently discard that data or claim the transfer is complete.

## Runtime and source

`worker/index.ts` is a plain Workers entry point. `lib/request-context.ts` isolates concurrent request headers with AsyncLocalStorage. Authentication, chat membership, photo access, and Hub access remain application-owned. `wrangler.jsonc` contains only deployment configuration and non-secret placeholders until the destination is selected. `drizzle/` contains the six schema migrations; migration 0005 adds the private photo store and transaction-level quota triggers.

Runtime secrets/settings:

- `BOOTSTRAP_ACCESS_HASH`: SHA-256 of Jerry's initial high-entropy setup grant. A consumed or replaced owner grant cannot be resurrected by the environment value.
- `BOOTSTRAP_ACCESS_EXPIRES_AT`: first owner setup expiry in milliseconds.
- `MAINTENANCE_LINK_KEY`: base64-encoded 32-byte AES key; preserve it when moving saved Hub connections.
- `WEBAUTHN_RP_ID`: canonical app hostname.
- `WEBAUTHN_ORIGIN`: exact canonical HTTPS origin; it is not inferred from caller-supplied headers.

Key implementation: `lib/access.ts`, `lib/passkeys.ts`, `lib/request-context.ts`, the API route handlers, `lib/photo-storage.ts`, `lib/prepare-photo.ts`, `lib/maintenance-links.ts`, `lib/file-deletions.ts`, and `lib/ai-privacy.ts`.

Optional browser WebMCP tools can list the current person's conversations, open one, and stage a draft for review when the browser supports that API. They do not send messages and are not required for the app to operate.

## Verification and practical limits

Latest readiness check: the 759-assertion access/recovery suite and 70-assertion maintenance-bot suite passed, and TypeScript checking completed successfully. The separate Miniflare storage rerun failed to start its local Workers runtime before running any assertions. Its earlier pass is historical; the current storage rerun remains unresolved. No live database was used by these checks.

The independent app has been type-checked, its frontend built with Vite, its Worker compiled locally with esbuild, and all six migrations applied successfully to a local D1 database. The server and storage checks passed 36 groups with 821 assertions: 30 groups exercised the actual API router, SimpleWebAuthn verifier, request context, and SQLite-backed D1 adapter; six additional groups exercised actual Miniflare D1 BLOB storage with outbound networking blocked. The Worker route suite made 421 requests and observed a maximum of 19 SQL statements per request in its cases. The `qa/independent-*.json` reports describe the specific server, photo, request-isolation, client, and service-worker checks; source hashes bind them to the tested files.

Older QA reports, if present, describe the prior app and do not by themselves validate this independent version. Cryptographic fixture tests use software passkeys and are distinct from browser-native prompts on a physical device. Mock-browser photo tests do not prove Safari's native canvas/image behavior. Local access/recovery tests were rerun successfully with 759 assertions; maintenance-bot tests passed 70 assertions, including private job scope, push retries and account ownership. These results do not establish production CPU capacity, physical-device recovery, weak-signal reliability or an independent security audit. The owner reported a successful phone notification test after deployment.

The initial CLI deployment dry-run was blocked and was not counted as successful verification. Publication subsequently proceeded through the authorized Cloudflare dashboard. Keep deployment secrets and personal Hub credentials private; the earlier blocked CLI attempt is historical context, not the current hosting status.

## Crew statuses and chat alerts

Home offers employee-selected Available, Working, Away and Driving statuses. Status clears after the chosen one, four or eight hours; it does not track location or infer activity. People and direct-message navigation show the current status. Driving pauses chat push alerts while active. Maintenance alerts retain their own settings.

Chat notifications are opt-in under Chat notifications. Employees connect their own notification device. Alerts cover unread direct messages and mentions using @ followed by the recipient's complete displayed name. Quiet hours use the saved time zone; individual conversations can be muted. Lock-screen text is generic. The background runner checks one eligible employee per tick, so alerts may take several minutes as the crew grows. Alerts older than 24 hours are not delivered. Provider acceptance is recorded per device and message; a lost response can cause a repeated alert, so delivery is best effort rather than exactly once. Account recovery invalidates earlier notification preferences until the employee enables them again.

Visible chat and thread updates poll every five seconds; other screens poll every thirty seconds. The composer shows sending, unconfirmed send, failed send or confirmed saved status. Retrying an uncertain send uses the same identity to avoid duplicate messages. Sent indicates storage confirmation, not delivery to another person's device or a read receipt.

Conversation options include Share job reference, which places an employee-entered job number and update into a draft for review. Personal Hub credentials are not inserted. Security & privacy includes lost-phone and offboarding instructions. The company logo comes from the existing Maintenance Hub brand asset.

## Database recovery

The production pms-crew D1 dashboard showed a seven-day Time Travel recovery window, and a pre-update bookmark was recorded before the additive status/notification migration. This is short-term point-in-time recovery, not a separately retained long-term export. A production restore into an isolated environment remains unverified. Do not restore the live database for a test: doing so overwrites its current state and can resurrect revoked sessions or deleted data. For an actual incident, pause writes and the bot runner, preserve the current state and configuration, choose a recovery point, restore only after explicit incident approval, reconcile revoked accounts and deletions, and verify messages, attachments, passkeys and encrypted Hub connections before reopening access. Keep the Hub encryption key and passkey hostname configuration available through the company's existing secure secret-management process.

More people can be added without rebuilding the workspace. Before broad rollout, run a two-week crew pilot, verify production backup restoration in an isolated environment, and test onboarding, recovery and maintenance notifications on real iPhone and Android devices. Later work can add richer roles, native maintenance forms backed by the Hub's permission model, or an authorized personal-AI connector. Direct AI integration needs provider-specific authorization and billing eligibility; the current shortcut does not make those claims.

## Conversation tools

Unread collects conversations with unread messages. Saved for later is personal; pinning remains shared with a conversation. Favorites and named sidebar sections are per employee. Conversation settings offer all new messages, mentions only (plus all direct messages), or muted. Global opt-in, quiet hours, legacy muted conversation choices and Driving take precedence. Existing unread messages may become eligible when a conversation preference changes.

Type @ to pick a member of the current conversation. Emoji reactions, Reply and Save for later are visible beneath messages. Profiles support self-selected job titles and resized JPG photos; workspace roles and access are unchanged. Shared files lists only attachments from accessible conversations. PDFs have a preview link for the browser PDF viewer and a separate download link, with the same member checks as photos. PDFs must fit 512 KB; up to three attachments and the shared 64 MB file budget remain. Large manual collections belong in the Maintenance Hub. Profile photos are stored separately, capped at 512 KB per person.

Job-reference cards are manually shared snapshots with ride, assigned person, progress and update. They open the viewer's own Hub; they do not grant access to someone else's job or change Hub job state.
