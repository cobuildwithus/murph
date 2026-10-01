# Run iOS canary against the verified production deployment

Status: completed
Created: 2026-09-18
Updated: 2026-09-18

## Goal and evidence

Scheduled and manual iOS canaries fail before native execution when the selected
main revision is newer than the production alias. The controller conflates its
trusted source with the deployment under test. Production can be ready while
newer candidates are still building or queued.

## Outcome and owner

The iOS workflow selects the actual production alias, proves protected-main
ancestry and exact deployment using the existing Vercel verifiers, and dispatches
the immutable private native runner for that SHA. The existing dispatch-time
comparison remains. A final exact-deployment check rejects deployment movement.
No product data, private runner source, credentials, or Android policy changes.
No new state, retry queue, dependency, or abstraction.

## Constraints and risks

Manual admission remains current-main-only. Private tag/run bindings, protected
environment, non-destructive identity and serialized concurrency remain intact.
A deployment change during the journey still fails rather than mixing evidence.
The private v3 contract is unchanged; workflow rollback affects only verification.

## Tasks and verification

- [x] Diagnose controller failure and inspect current deployment metadata.
- [x] Reuse exact production verification before and after the native journey.
- [x] Run workflow shell regressions, native controller tests, and tool typecheck.
- [x] Review the diff, update owner docs, commit and submit the candidate.
- [x] Complete ReviewGPT and final parent review of the implementation.

## Product UX

Internal CI correction only; no member-visible product change or changelog.

## Focused results

- Native iOS/Android controller tests: 25 passed, including executable selection
  and final-verification regressions.
- Existing Vercel deployment-verifier tests: 9 selected tests passed.
- Repository tooling typecheck: passed.
- Complexity guard: passed; no authored runtime JavaScript/TypeScript change.
- Parent review: protected-main admission, production origin, immutable private
  source, exact returned run, non-destructive identity, and concurrency retained.

## Review and acceptance handoff

ReviewGPT round 1 passed on dd28c5bf6a03665f385c5a046e7d4d1eb19dc209
with no qualifying findings. The parent verified the requested model, response
marker, exact head and attachment, and preserved the reviewed implementation.
This closeout changes explanatory evidence only and needs no substantive rerun.

Required CI on the final head and a fresh current-main production canary remain
external acceptance gates. After merge, dispatch native-ios-hosted-e2e.yml and
require both the private native journey and final deployment verification to pass.
Do not count the local or review tests as live iOS execution.
Completed: 2026-09-18
