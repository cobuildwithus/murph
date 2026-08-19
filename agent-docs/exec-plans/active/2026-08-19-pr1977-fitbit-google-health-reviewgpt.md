# PR 1977 Fitbit to Google Health ReviewGPT completion

## Goal

Finish the replacement Fitbit-to-Google-Health migration PR with exact-source
history preservation, no current-day visibility gap, focused proof, green
required CI apart from the explicitly waived native iOS lane, and a final
zero-finding ReviewGPT round, and merge it.

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
- Out of scope: unrelated provider changes and the native iOS CI failure
  explicitly waived by the user.

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
9. [x] Resolve round 7's durable job-lineage finding through the existing Web
   source epoch without adding a persisted owner, then push focused proof.
10. [x] Run the explicitly authorized round 8 and resolve its provider-day
    timezone-authority finding without adding persisted state or provider work.
11. [x] Commit and push the round-8 remediation with exact-head evidence.
12. [x] Run the explicitly authorized round 9 and resolve its webhook replay
    finding through the existing trace-keyed mailbox identity and source epoch.
13. [ ] Push the round-9 correction, obtain a zero-finding confirmation on the
    exact head, prove a clean current-base merge, archive this plan, and merge.

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
- Final round 8: accepted that daily finalization still used the member vault's
  mutable timezone rather than the accepted Fitbit provider day. The correction
  removes the vault timezone from coverage authority, preserves timezone-free
  Junction provider-day events at Core's canonical boundary, resolves close by
  accepted IANA timezone then accepted offset, retains the latest close for
  mixed same-day provenance, and falls back to the existing UTC-12 global-close
  boundary. The sole substantive finding was accepted; none was rejected. The
  response's rendered-evidence observation was not a backend correctness
  finding. No state, schema, job, queue, provider call, or fanout was added.
- Final round 9: accepted that an intentionally retried Google daily webhook
  could be redelivered after same-source reauthorization and stamp the retry
  attempt onto the new source epoch before discovering its trace-keyed wake was
  a duplicate. The correction always resolves the dedicated migration trace
  item in the existing admission transaction, advances freshness only for a
  newly inserted trace whose original acceptance follows the exact source
  epoch, and carries the already-read `firstSeenAt` in the minimal admission
  projection. No finding was rejected and no persisted state, query, queue,
  retry owner, or lifecycle process was added.

The first round-8 invocation rejected a malformed PR-body hash token before
review. Correcting the packaging metadata and retrying the same invocation was
a tooling retry, not an additional substantive ReviewGPT round.

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
  changed lines; this round-7 remediation candidate is 73 files and 8,931
  changed lines, a review-driven increase of 13 files and 2,948 lines. With
  tests, docs, changelog, package/TypeScript configuration, and the inert design
  study excluded consistently, authored production churn is 4,424 lines, 726
  above the first-reviewed head. This remediation itself is 646 changed lines,
  of which 231 are authored production source and the remainder is focused
  proof and owner documentation. The retained concepts remain one Web source
  epoch, existing backfill jobs/continuations, one terminal source marker, and
  the existing cutover lock; the review did not add a state owner or process.

## Round-8 retrospective

- Authority: the committed provider event now exclusively owns daily close
  provenance. The vault timezone still supports ordinary normalization but no
  longer participates in migration-finalization authority.
- Fallback: valid provider IANA timezone wins, followed by a valid fixed offset;
  invalid or absent provenance waits for the already-established UTC-12
  globally closed boundary. Multiple events for one source/resource/day wait
  for the latest close.
- Core boundary: Junction events with an explicit provider day and no explicit
  timezone remain timezone-free, preventing Core from synthesizing mutable
  profile state that could outrank a real provider offset.
- Complexity: the correction extends the existing pure coverage reducer and
  deletes its vault-timezone input. It adds transient close calculation and
  focused proof only; no persisted owner, schema, process, retry path, provider
  request, or database fanout was introduced.

## Round-9 retrospective

- Authority: the existing trace-keyed migration mailbox item is now the durable
  first-admission fact. A retry-attempt clock cannot replace it as successor
  freshness authority.
- Ordering: the same health-data admission transaction resolves that identity
  before stamping the exact Google source. A duplicate trace and a request
  accepted before the current `firstSeenAt` leave `lastDataAt` unchanged.
- Composition: the dedicated migration identity is resolved even when the same
  delivery also appends the existing source-confirmation wake, so releasing the
  public trace claim cannot erase first-admission history.
- Complexity: the correction reorders existing operations, adds `firstSeenAt`
  to an existing minimal projection, and adds focused proof. It introduces no
  schema, state owner, query, job, queue, manager, or reconciliation process.

## Evidence so far

- The user additionally required screenshot submission for every UI-touching
  PR. This candidate restores that rule in the workflow owner docs, PR
  template, and executable frontend-evidence guard. The current PR will embed
  the already-inspected production-faithful desktop and mobile migration
  states in its Evidence section.

- Core: 46 files, 803 tests passed after the round-8 correction.
- Importers: 19 files, 479 tests passed.
- Device Sync: 49 files, 1,181 tests passed after the round-7 correction;
  focused epoch and blood-pressure recovery proof passed 376 tests.
- Focused Web migration/connect proof: 3 files, 124 tests passed on the current
  candidate.
- Round-6 Web authority proof: 1 file, 76 tests passed.
- Assistant Runtime: 89 files passed, 1 skipped; 2,404 tests passed, 5 skipped.
- Core, Device Sync, Assistant Runtime, Importers, and Web prepared typechecks
  passed.
- Package-local scoped Web lint, documentation drift, documentation gardening,
  and diff whitespace checks passed.
- Round-9 focused Web proof first reproduced three failures: a duplicate trace
  and a pre-epoch first insertion both restored freshness, and a combined
  source-confirmation delivery omitted its dedicated migration identity. The
  corrected wake/source projection suite passes 191 tests; the real-PostgreSQL
  ingress replay proof covers trace release, source reauthorization, mailbox
  dedupe, and a distinct current-epoch trace.
- Round-6 warm/cold hydration, local-store epoch replacement, delayed callback
  rejection, current-epoch arrival, same-epoch alias, and maintenance retry
  proofs pass. Round-8 provider-timezone proof covers IANA and offset precedence,
  DST, invalid and absent provenance, mixed same-day provenance, mutable vault
  timezone changes, and the UTC-12 convergence boundary. The round-9 correction
  still requires exact-head typecheck, PostgreSQL proof, CI, and ReviewGPT
  confirmation before merge.

## Deployment concern

Deploy importer and Device Sync consumers before hosted runtime and Web so a
temporarily mixed release continues to keep Fitbit active rather than cutting
over before the new terminal-history proof is understood.
