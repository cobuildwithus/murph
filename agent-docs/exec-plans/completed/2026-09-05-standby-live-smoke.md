# Verify standby inventory through protected deployment smoke

Status: completed
Created: 2026-09-05
Updated: 2026-09-06

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

## CI correction and deployment boundary

Release CI passed every lane except an unrelated Training summary fixture. Its fixed August workout crossed the 30-day summary cutoff because the fixture used the machine clock. The same single failure reproduced locally. Passing the selector's existing fixture-date and UTC options fixes the test without changing production behavior; all 14 focused tests and the Web typecheck pass.

The protected private workflow remains unchanged at its reviewed migration revision. Parent inspection confirms container smoke enablement, candidate-version pinning, expected-mode forwarding, bounded retry and smoke-success gating. Its smoke invocation currently uses the CLI default target two, matching this rollout; a different target would require forwarding that value into the smoke step as well.

The first ReviewGPT capture finished below the repository minimum duration and was discarded. A second capture was invalid because the invocation unnecessarily requested independent private-caller inspection from the public snapshot. The corrected invocation reviews the complete public patch under the declared caller contract; these are tooling/invocation retries of round one, not accepted bug findings.

## Implementation handoff

The implementation and focused proof are complete. The final authored delta after the review baseline contains only the reproduced fixture-clock correction and explanatory evidence; production source is unchanged. The active review owns the baseline snapshot, and the PR will record its result plus exact-final-head CI before merge. Protected shadow and allocation deployments remain operational follow-through for the authorized rollout, not completed live evidence.
Completed: 2026-09-06
