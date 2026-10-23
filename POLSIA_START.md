Prepare Teamstead Crew, the commercial product with Chat, Maintenance Hub and Parts Finder, using this starter handoff.

Begin by reading README.md and SOURCE_STATUS.md. This is partial reference source, not a complete runnable backup. Do not assume Parts Finder is built or the inherited Kindred Ease repository main is the Teamstead app.

1. Inventory the supplied files and report missing frontend, backend, schema, assets and configuration for each module.
2. Reuse verified Teamstead-specific code where appropriate. Flag unavailable local paths and old production-oriented scripts.
3. Work only in the independent cartersites-arch/teamstead-crew repository, branch test/teamstead-development, if access is provided. Otherwise use an isolated workspace and deliver an export. Leave main and the original Kindred Ease and PMS repositories unchanged.
4. Recover complete Chat/Maintenance project exports before claiming source parity. If exports cannot be obtained, clearly propose reconstruction and estimate the work instead of silently substituting a different app.
5. Start Parts Finder design/prototype from PARTS_FINDER_REQUIREMENTS.md and explicitly label new work.
6. Use fictional test data and isolated test services. Preserve company separation, role restrictions, photo access control and English/Spanish reader-language display with original text available.
7. Do not deploy over live Teamstead/PMS, run migrations against production, reuse production secrets, send messages to employees or perform purchases. Ask the owner for the specific access/configuration needed when ready.
8. Return a short report: recovered, missing, built, tested, blocked and next step. Distinguish historical evidence from tests you actually run.

First milestone: a source gap report plus an isolated, reproducible development plan. Any working prototype must identify mock versus real services.
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
