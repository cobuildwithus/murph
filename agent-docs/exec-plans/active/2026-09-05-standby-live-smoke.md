# Verify standby inventory through protected deployment smoke

Status: active
Created: 2026-09-05
Updated: 2026-09-05

## Goal

Complete the authorized two-container standby activation. The initial unified fleet deployment is healthy with inventory off. The existing production smoke proves the configured mode but does not inspect ready inventory, and the test-only inventory route must stay disabled in production.

## Design

Extend the existing callback-signed container-smoke route and its CLI verifier. Before the initial container probe, use the current release's canonical coordinator to ensure and read its bounded inventory. Return only release-match and count metadata. Require distinct ready slots at the configured target with no pending preparation; retry incomplete inventory through the existing bounded smoke retry. Keep the live-model phase on its previously verified container. No new public endpoint, local production credential access, member messages, or allocation policy changes.

## Validation and rollout

- Add signed-route coverage for ready, incomplete, stale and duplicate inventory, including no allocation and no identifier disclosure. Preserve off-mode and authentication coverage.
- Add CLI coverage for missing or mismatched inventory proof and successful proof.
- Run focused tests, Cloudflare typecheck, docs and complexity checks; complete parent review and required final ReviewGPT plus exact-head CI.
- Merge and deploy with shadow mode through the protected workflow, verify actual inventory and live rollout, then activate and observe foreground claims and background exclusion. Preserve the legacy reservation and migration-compatible code.

## Scope

Internal operational verification only. No member-facing UI or provider-input changes. The workflow continues to hold production credentials inside its protected execution boundary.

## Implementation evidence

- The original signed route failed all five new inventory cases before the change: missing proof for ready inventory and incorrect success for incomplete or stale inventory.
- Both focused route and CLI files pass: 179 tests. Unsigned requests cannot reach coordination; the separate model phase remains independent of inventory consumption.
- Cloudflare build and typecheck pass. Documentation drift and complexity guards pass, with no changed-function hotspot above 20.
- Parent candidate review confirms canonical coordination, bounded existing retries, no slot allocation, no member identifiers, and no foreground or provider-input changes.
- Final ReviewGPT, exact-head CI and protected production rollout remain pending.
