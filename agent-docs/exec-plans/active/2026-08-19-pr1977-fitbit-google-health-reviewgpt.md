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
6. [x] Resolve the accepted round-5 canonical-import ownership finding and run
   ReviewGPT round 6 on the remediated head.
7. [x] Reproduce and correct round 6's same-source reauthorization epoch rewind
   without adding a persisted owner or retry path.
8. [x] Push the round-6 correction and run the final allowed ReviewGPT round 7.
9. [ ] Resolve round 7's durable job-lineage finding through the existing Web
   source epoch without adding a persisted owner, then push focused proof.
10. [ ] Prove a clean current-base merge, mark the
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
- Final round 6: accepted that a same-source Google reauthorization could reset
  Web's authorization epoch and then have stale local arrival and history state
  merged back into it. The correction makes the existing Web source row the
  epoch owner: exact later epochs replace local lifecycle evidence, old-epoch
  callbacks fail their source fence, and runtime updates cannot rewrite an
  existing Web `firstSeenAt`. Same-epoch provider aliases retain their existing
  consolidation behavior.
- Final round 7: accepted that queued, leased, deferred-retry, timeseries, or
  workout jobs could retain proof flags and cursors from the prior Web-owned
  source epoch, then write a new completion timestamp after reauthorization.
  The requirement-level decision is that explicit Google reauthorization needs
  a fully fresh exact Google and Fitbit proof. One existing mechanism owns that
  decision: proof jobs bind to the authorizing Web source slug and `firstSeenAt`,
  that pair joins the existing dedupe identity, and stale lineages are
  superseded before more provider work, continuation, or marker projection.
  Already accepted canonical imports remain; no timestamp owner, migration
  ledger, queue, scheduler, manager, or reconciliation process is added.

## Round-7 retrospective

- Source row: continue the round-6 design. Web's persisted `firstSeenAt` remains
  the sole authorization epoch; hosted job-time listing now prefers that Web
  value over a stale local copy.
- Job lineage: redesign the existing backfill payload and dedupe identity so the
  Web epoch is carried through current proof-producing work. Old unbound jobs
  remain import carriers only and cannot project migration completion.
- Cutover proof: keep the single completion timestamp, but accept it only from a
  job whose existing epoch binding is still current. There is no new completion
  guard owner or per-continuation state machine.
- Deletion choice: superseded bound jobs finish without provider I/O or another
  continuation; their old cursors and Boolean evidence are not migrated into a
  replacement mechanism. The fresh exact jobs already scheduled by the current
  authorization are the only proof path.
- Composition proof covers same-day and cross-day epochs; queued, running,
  deferred, timeseries, and workout payloads; a reauthorization during provider
  work; warm/cold Web-authoritative source reads; fresh Google arrival before
  terminal history; and the existing exactly-once Fitbit revoke boundary.
- Immutable review growth: the first-reviewed patch was 60 files and 5,983
  changed lines; this round-7 remediation candidate is 73 files and 8,917
  changed lines, a review-driven increase of 13 files and 2,934 lines. With
  tests, docs, changelog, package/TypeScript configuration, and the inert design
  study excluded consistently, authored production churn is 4,424 lines, 726
  above the first-reviewed head. This remediation itself is 622 changed lines,
  of which 231 are authored production source and the remainder is focused
  proof and owner documentation. The retained concepts remain one Web source
  epoch, existing backfill jobs/continuations, one terminal source marker, and
  the existing cutover lock; the review did not add a state owner or process.

## Evidence so far

- Importers: 19 files, 475 tests passed.
- Device Sync: 49 files, 1,181 tests passed after the round-7 correction;
  focused epoch and blood-pressure recovery proof passed 376 tests.
- Focused Web migration/connect proof: 3 files, 263 tests passed.
- Round-6 Web authority proof: 1 file, 76 tests passed.
- Assistant Runtime: 89 files passed, 1 skipped; 2,404 tests passed, 5 skipped.
- Device Sync, Assistant Runtime, Importers, and Web prepared typechecks passed.
- Package-local scoped Web lint, documentation drift, documentation gardening,
  and diff whitespace checks passed.
- Round-6 warm/cold hydration, local-store epoch replacement, delayed callback
  rejection, current-epoch arrival, same-epoch alias, and maintenance retry
  proofs pass. The final ReviewGPT/CI gate remains pending: round 7 exhausted
  the seven-round hard cap, so review of this candidate requires explicit user
  authorization for round 8, and GitHub Actions currently cannot start because
  of an account billing lock.

## Deployment concern

Deploy importer and Device Sync consumers before hosted runtime and Web so a
temporarily mixed release continues to keep Fitbit active rather than cutting
over before the new terminal-history proof is understood.
