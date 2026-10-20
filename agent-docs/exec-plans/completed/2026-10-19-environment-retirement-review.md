# Environment retirement review and PR completion

Status: completed
Created: 2026-10-19
Updated: 2026-10-19

## Outcome

Prepare the reviewed candidate for PR #4211 with safe persisted-state
retirement, preserved shared regression coverage, current design proof and
Claude review. External ReviewGPT and exact-head CI follow the candidate commit.
This plan supersedes the drain prerequisite in the completed initial removal
plan; completed plans remain historical evidence.

## Findings and decisions

- Retired events inside saved system-mailbox snapshots must be discarded at
  the existing state reader before active wake/action/cleanup parsing. Expired
  recordings can never finish on old consumers, so a universal drain is not
  a viable deployment prerequisite. Preserve strict validation for active and
  unknown events, handled-prefix ordering and the existing R2 cleanup backstop.
- Restore shared cold-restore/projection/preemption tests with an active event.
- Remove deleted-page telemetry entries, unused animation CSS and the
  Environment-only Habitat browser-replica projection. Canonical Habitat CLI,
  assistant context and ordinary Journal events remain.
- Verify responsive navigation using the real component, publish safe proof,
  and document retained cleanup and actual rollout behavior in the PR.

## Work and proof

1. Implement saved-state retirement and focused mixed-state/cold-read tests.
2. Remove proven browser-only leftovers; update current owner docs and tests.
3. Restore the nine shared runtime scenarios with Claude and inspect the result.
4. Run affected tests/typechecks and privacy/complexity/docs checks.
5. Close and commit the verified candidate through the repository workflow.
   Track external ReviewGPT, exact-head CI and any subsequent remediation in
   the PR; launch ReviewGPT alongside CI on the stable pushed head.

No production data mutation or production deployment is part of this work.

## Candidate verification

- Saved-state retirement: 42 mailbox-state tests pass, including retired
  pending/sending/recording entries, active successor progress, durable rewrite
  and strict rejection of unknown or malformed active wakes.
- Claude restored all nine shared checkpoint scenarios using real device-sync
  import and snapshot restore. The suite passed twice; provider reads do not
  repeat after restoration. Parent inspected the diff against the deleted test.
- Query replica tests: 23 pass. Web telemetry/persona/dashboard tests: 49 pass.
  Changelog tests: 60 pass. The broader Web run found one deleted study path in
  a design-catalog test; the corrected suite passes all 10 tests. The broader
  run remains in progress at this candidate commit.
- Runtime, query and Web typechecks pass; query build passes. Complexity, docs
  drift, whitespace and identifier scans pass. No new production abstraction.
- Phone and desktop Playwright navigation checks pass; both native-resolution
  captures were inspected and attached to PR #4211. The isolated hosted preview
  is queued for Vercel build capacity; hosted reachability remains pending.
- Claude findings were independently checked. Snapshot retirement supersedes
  the impossible old-runtime drain; only the existing private-audio expiry and
  account-deletion sweep remain. Canonical Habitat and ordinary voice/weather
  behavior are preserved. New browser replicas omit unused Habitat records.
- No production deployment or data mutation occurred. External ReviewGPT and
  exact-head CI remain PR completion gates after this commit.
Completed: 2026-10-19
