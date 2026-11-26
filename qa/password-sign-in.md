# Password sign-in (test branch: feature/password-sign-in-test)

Adds email + password as an alternative credential alongside passkeys.
Passkey sign-in and personal setup/recovery links are unchanged.

## How it works

- `people.password_hash` (new column, migration `drizzle/0025_password_sign_in.sql`)
  stores only a PBKDF2-SHA256 hash via WebCrypto (`lib/passwords.ts`):
  `pbkdf2-sha256$210000$<salt>$<derived key>`. No new dependency.
- Because most accounts have no email stored, setting a password also sets
  the account's email (must be unique among active accounts in the workspace).
- New sessions use `auth_level = 'password'` and get the same 7-day session
  cookie as passkey sign-in. Session gates (`lib/access.ts`,
  `lib/security-events.ts`, security session list) accept both levels.
- Endpoints (`app/api/passwords/route.ts`, rate-limited to 30/min/IP):
  - `sign_in` — email + password → session. Generic error for unknown email
    or wrong password; a dummy PBKDF2 run keeps timing uniform.
  - `set_password` — from a setup session it completes enrollment exactly
    like passkey setup (link consumed, setup session replaced, auth_version
    bumped; a recovery link may reset an existing password). From a full
    session it requires a recent verification, like adding a passkey.
  - `reauth` — re-confirm password to refresh recent verification.
- UI: access gate offers "Sign in with password" next to the passkey button,
  and the setup screen offers "Create my password" next to "Create my
  passkey". Security panel gains a "Your password" card (set/change).
  Public signup copy now says owners may choose a passkey or a password
  (the choice itself happens on the setup screen the signup redirects to).
- Revocation: owner account reset (`resetPersonalLink`) and member removal
  now also clear `password_hash`.

## Local verification (2026-11-25)

- `npm run check` (tsc) — clean. `npm run build` and `npm run build:worker` — pass.
- Local D1 migrations applied including 0025; worker run locally with
  `wrangler dev --local` (compatibility-date overridden to 2026-05-22 for the
  local runtime only; no repo file changed for this).
- End-to-end against the local worker with a seeded invite link:
  setup link → set password → session level `password`; wrong password 401;
  sign-in with correct password (email case-insensitive) OK; reauth OK;
  Security GET lists the password session; setup link consumed
  (inspect returns enrolled mode); change password from a full session OK,
  old password rejected, new password accepted; passkey `auth_options`
  still returns options. Stored hash prefix verified as
  `pbkdf2-sha256$210000`, and security events `password_setup_completed`,
  `password_signed_in`, `password_confirmed`, `password_changed` were logged.

## Deploy steps still required later (per project, direct upload)

1. Apply the D1 migration to that project's database:
   `ALTER TABLE people ADD COLUMN password_hash text;`
   For existing per-company workspaces, also run the same ALTER on each
   `<prefix>people` table (new companies get the column from
   `lib/company-template.ts`).
2. Build and direct-upload the project as usual (teamstead-crew,
   project-room, teamstead-capacity-chat with its own database migration).
   crew-maintenance needs no separate code — the checkout company-setup
   choice lives in this repo's access gate / signup copy.
3. Known limitation: a password-only session that hits a "recent
   verification" (428) prompt outside the Security panel falls back to
   signing in again, because the automatic re-confirm helper is
   passkey-based. Password reauth exists at `POST /api/passwords`
   (`action: 'reauth'`) for a future prompt UI.
