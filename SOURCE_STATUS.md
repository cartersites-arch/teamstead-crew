# Source status

| Component | Included | Still needed |
|---|---|---|
| Chat | React chat/language/conversation source snapshots, local translator and privacy/state checks, release notes | Complete current frontend project, backend Worker source, routes, authentication and message/channel schema/migrations, upload handlers, reproducible build configuration |
| Maintenance Hub | Company integration TypeScript, onboarding/schema-builder SQL, translation client and scripts, branding/security change scripts | Complete current frontend, backend/API implementation, full migrations and role/access policy definitions, inspection/work-request/approval/upload implementation, reproducible build configuration |
| Parts Finder | Requirements in this package | Actual source repository or project export; implementation has not been verified |

## Hosting inventory — read-only check in this preparation

Cloudflare account: Teamstead Software.
- Pages project teamstead-crew; subdomain teamstead-crew.pages.dev; production deployment 98c9f1e2-d618-4ad1-a099-898a368e18e4. Historical release notes associate it with teamsteadcrew.com.
- Pages project pms-company-hub; subdomain pms-company-hub.pages.dev; production deployment 04c2a3a1-a5f3-430c-805d-6235456d0314. Despite its legacy project name, historical notes identify it as the commercial Teamstead Maintenance Hub.
- Neither returned project record has a linked Git source field. This does not prove no source exists elsewhere.
- Other projects include project-room, crew-maintenance and capacity-test projects. Do not assume they are Teamstead production source.

Cloudflare metadata establishes deployment locations, not possession of complete original source. A served browser bundle is not equivalent to an original maintainable source project. No database content or secret values were fetched.

## Recovery checklist for the owner / original build workspace

Obtain the original project-folder export for each app, containing package and lock files, source directories, backend/Worker code, schema migrations, configuration templates and static assets. Exclude node_modules, real .env files, API keys, database dumps, employee/customer photos and private sign-in links. Compare the exported commit/build against the deployed version before calling it complete. Obtain Parts Finder's project export or treat it as a new module built from the requirements.

## First engineering deliverable

Produce a file-by-file gap report. Identify which supplied excerpts can be integrated, which are obsolete, and what must be recovered or rebuilt. Establish a local/test application using fictional records only. Do not present the inherited Kindred Ease main app as Teamstead or deploy it over the current service.
