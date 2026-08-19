# PR 1977 Fitbit to Google Health ReviewGPT completion

## Goal

Finish the replacement Fitbit-to-Google-Health migration PR with exact-source
history preservation, no current-day visibility gap, focused proof, green
required CI apart from the explicitly waived native iOS lane, and a final
zero-finding ReviewGPT round. Keep the PR unmerged.

## Success criteria

- Google Health does not replace an active Fitbit source until a Fitbit history
  pull started after Google authorization reaches its terminal marker.
- Migration readiness is derived from canonical boundaries actually produced,
  with normalized successor resource aliases and valid-empty history support.
- Accepted current-day Fitbit facts remain canonical and provisional until the
  provider closes the day; the migration does not delete them while waiting.
- No new state owner, job type, queue, or compatibility layer is introduced.
- Focused tests, affected typechecks, documentation guards, exact-head required
  CI, and a zero-finding ReviewGPT round pass before the PR is marked ready.

## Scope

- In scope: Junction Fitbit/Google Health import admission, migration readiness,
  connect-time work scheduling, status projection, focused regression proof,
  owner documentation, PR evidence, and final review gates.
- Out of scope: merging the PR, unrelated provider changes, and the native iOS
  CI failure explicitly waived by the user.

## Plan

1. [x] Recover exclusive ownership of the existing PR head and ReviewGPT thread.
2. [x] Resolve the preliminary specialist and final rounds 1 through 3.
3. [x] Reproduce and correct round 4 with deletion-first ownership boundaries.
4. [x] Run focused importer, Device Sync, Web, lint, and typecheck proof.
5. [x] Commit and push the round-4 remediation, then run ReviewGPT round 5 with
   exact-head CI.
6. [ ] Resolve the accepted round-5 canonical-import ownership finding and run
   ReviewGPT round 6 on the remediated head.
7. [ ] Prove a clean current-base merge, mark the
   PR ready, and archive this plan without merging.

## ReviewGPT ledger

- Preliminary specialist pass: accepted screenshot-fixture, retry-ownership,
  live-region, and client-coverage gaps; fixed them without a new state owner.
- Final round 1: supplied the required retrospective; no code change.
- Final round 2: accepted that historical deliveries could satisfy a fresh
  migration gate; required source-scoped post-authorization history proof.
- Final round 3: accepted early/nonterminal history completion and provider
  identity-collapse findings; narrowed the fix after rejecting an overly broad
  filtering implementation, not the findings.
- Final round 4: accepted capability-versus-production and current-day deletion
  findings. The correction deletes special daily admission, schedules one
  existing exact Fitbit backfill at Google authorization, waits for its terminal
  marker, derives obligations only from canonical boundaries actually produced,
  and normalizes successor resource aliases.
- Final round 5: accepted that bounded summaries, daily aggregates, and full
  timeseries continuations bypassed the existing fence/receipt owner. The
  correction routes every source-bearing import through one provider-local
  commit boundary; companion-only imports remain separate and no state owner,
  marker, job, retry loop, or database fanout was added.

## Evidence so far

- Importers: 19 files, 475 tests passed.
- Device Sync: 49 files, 1,177 tests passed after the round-5 correction.
- Focused Web migration/connect proof: 3 files, 290 tests passed.
- Device Sync, Importers, and Web prepared typechecks passed.
- Package-local scoped Web lint passed.
- Round-5 focused provider composition, Device Sync typecheck, and full Device
  Sync tests pass. Documentation guards and the final ReviewGPT/CI gate remain
  pending; GitHub Actions currently cannot start because of an account billing
  lock.

## Deployment concern

Deploy importer and Device Sync consumers before hosted runtime and Web so a
temporarily mixed release continues to keep Fitbit active rather than cutting
over before the new terminal-history proof is understood.
