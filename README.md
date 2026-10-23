# Teamstead Crew — Polsia starter handoff

This repository snapshot is ready for source assessment and isolated development planning. It is NOT a complete runnable backup of Teamstead Crew.

## Start here

Read POLSIA_START.md, SOURCE_STATUS.md and PARTS_FINDER_REQUIREMENTS.md before running anything. The source excerpts in docs/ are preserved from commit ab7841950e7fe864ebd448ca7d2a449052db5353, branch test/language-consistency-20261020, originally cartersites-arch/kindred-ease-space. They include integration snapshots and historical release evidence, not complete current production applications.

The independent public repository is https://github.com/cartersites-arch/teamstead-crew . Work on test/teamstead-development. main is an inherited Kindred Ease baseline and is not the latest Teamstead application. The test branch starts from the Teamstead evidence commit above. GitHub access must be granted separately through GitHub if Polsia needs it; this repository does not grant access.

## Product scope

Teamstead is the commercial product: Chat, Maintenance Hub and Parts Finder. Preserve company isolation and phone/desktop support. PMS is a separate internal project; do not mix PMS records or deployments into this product.

## Package contents

- docs/: Teamstead-specific code excerpts, SQL, dependency manifests and historical verification notes.
- SOURCE_STATUS.md: confirmed locations and exact missing source items.
- PARTS_FINDER_REQUIREMENTS.md: starting requirements, with implementation unverified.
- POLSIA_START.md: instructions to paste into Polsia alongside this ZIP.

## Validation limits

The source ZIP used for the handoff passed its integrity check. No complete application build or end-to-end test was possible from these excerpts. Historical test claims in reference notes are not fresh tests of this package. Paths in old scripts may point at unavailable workspaces or production destinations; inspect and adapt them before use. No production credentials or customer database exports were intentionally collected for this handoff. This is not a comprehensive security audit of the inherited code.
