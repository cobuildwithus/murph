# Reconcile Junction compact timeseries collections

Status: active
Created: 2026-08-12
Updated: 2026-08-12

## Goal

- Resolve the accepted ReviewGPT findings on PR 1707 without adding another
  cursor, watermark, scheduler, or state owner.

## Success criteria

- Every scheduled reconcile refreshes the latest globally closed date for the
  six fidelity resources without widening the hourly all-resource fanout.
- Successful sparse fidelity resource jobs refresh daily totals for every
  globally closed provider date intersecting their precise window.
- Daily sums and dense feature envelopes reconcile non-empty complete-set
  growth and removal without treating a child-row revision as the collection
  revision.
- Stable sparse interval identities retain their explicit revision ordering and
  exact replays remain no-ops.
- Durable architecture and ingestion docs describe the implemented ownership.
- Focused tests, affected package typechecks/build, repository guards, required
  CI, and the routed ReviewGPT stopping condition pass.

## Scope

- In scope: Junction provider scheduling, compact timeseries normalization and
  core reconciliation, focused device-sync/importer/query coverage, and the
  owning architecture/ingestion docs.
- Out of scope: new persistent state, new transport resources, raw dense sample
  retention, or changes to unrelated providers.

## Tasks

1. [x] Delete the account-clock gate while retaining UTC-12 closure filtering
   inside the bounded daily importer.
2. [x] Remove derived max-child versions from daily and dense feature facts;
   retain revisions only on stable sparse interval records.
3. [x] Add store-level closure-race, non-empty complete-set growth/removal,
   stable-row, and exact-replay regression coverage.
4. [x] Align the architecture, importer, and ingestion-invariant owners.
5. [x] Reproduce and reject round six's proposed output-cap correction as a
   pre-existing integration-ingest limit, then clarify the durable contract.
6. [x] Remove round seven's synthetic-midnight temporal derivation, complete
   local proof, commit and push the exact candidate, then run required CI.
7. [x] Record the hard-cap retrospective and obtain an explicit continuation
   decision before any eighth ReviewGPT round.
8. [x] Land the bounded PR-schema and runner-bundle budget corrections and run
   round eight against the exact pushed head.
9. [x] Resolve round eight's sparse-correction and hourly-fanout findings, then
   run round nine against the exact pushed head.
10. [ ] Resolve round nine's provider-day correction finding, obtain exact-head
    green CI and a ReviewGPT PASS, then merge and retire the task worktree.

## Decisions

- The scheduled pull floor remains unconditional, but its timeseries work has
  two bounded cadences: one latest-closed-day pass for the six fidelity
  resources every reconcile, and the prior seven-day all-resource correction
  sweep only after the account crosses a UTC day.
- Successful sparse fidelity resource jobs return the canonical importer's
  provider-local day keys and reuse the calendar-day importer for each closed
  corrected date; no second aggregate owner or correction queue is required.
- A child-row timestamp cannot order the complete resource/day collection.
  Serialized canonical event-spine reconciliation is the existing owner for
  unversioned daily and dense feature facts.
- Sparse stable-row revisions remain useful because they order one durable
  identity rather than a changing set.
- Empty provider collections do not emit aggregate tombstones; the documented
  revision surface is limited to non-empty set growth and removal.
- ReviewGPT round six's global-output finding is pre-existing rather than
  PR-caused: the proposed 11,522-event reproduction also fails the unchanged
  base integration-ingest contract, and live imports always persist a complete
  output list. Expanding that contract is outside this fidelity change.
- ReviewGPT round seven's date-only temporal finding is accepted. Date-only
  dense rows remain daily facts but cannot become temporal samples; their
  complete-day feature owner publishes zero coverage so stale clock-derived
  facts clear without another state owner.

## Hard-cap retrospective

- The original requirement remains one bounded six-resource outcome: retain
  exact sparse timing and truthful compact dense temporal shape without raw
  sample retention or another canonical/state owner.
- The first-reviewed patch had 2,030 source additions and 38 deletions. The
  remediated patch has 2,483 source additions and 68 deletions; the cumulative
  first-head remediation is 513 additions and 90 deletions. Round seven's fix
  contributes 67 source additions and 5 deletions, with no new owner, queue,
  cursor, watermark, schema family, dependency, or persisted state.
- Deleting the temporal feature path would abandon the requested glucose,
  oxygen, and stress outcome. Merely skipping date-only envelopes would strand
  prior clock-derived facts. The smallest complete correction is therefore the
  current provider-clock admission check plus an empty envelope through the
  existing feature identity.
- Decision: continue with this bounded correction, then pause at the seven-round
  hard cap. Do not start round eight until the user explicitly chooses to
  continue after reviewing this retrospective.
- The user explicitly authorized round eight on 2026-08-12 while directing the
  agent to make CI green and merge. The known CI corrections remain metadata
  schema completion plus measured bundle-budget ratchets; neither adds product
  behavior or a runtime owner.
- Round eight's two review-induced findings are accepted. Restoring the prior
  daily broad-sweep gate and reusing the existing calendar importer for hourly
  fidelity catch-up and sparse correction adds no state owner, queue, cursor,
  watermark, dependency, or service.
- Round nine's review-induced finding is accepted. Precise sparse corrections
  now select calendar refreshes from transient canonical provider-day evidence
  instead of UTC execution-window dates. The existing import receipt and
  calendar importer carry the evidence and perform the refresh, so the fix adds
  no persisted state, queue, cursor, watermark, dependency, or service.

## Verification

- Passed focused store-level regression proving pre-closure suppression,
  higher-priority resource completion, and post-closure daily import.
- Passed focused query regression proving same-max set growth, lower-max set
  removal, paired daily/feature publication, and exact-replay collapse.
- Passed all 222 Junction provider tests, all 164 Junction importer tests, and
  all 20 normalized wearable-surface tests.
- Passed affected `core`, `importers`, `device-syncd`, and `query` typechecks,
  the importer build, scenario-manifest integrity, and `git diff --check`.
- Reproduced ReviewGPT round six's proposed 11,522-event historical batch and
  proved it fails the base branch's pre-existing 10,000-output integration
  ingest contract; no out-of-scope contract expansion was retained.
- Round seven returned one original-PR finding: date-only dense readings were
  assigned synthetic midnight temporal evidence. Focused importer and canonical
  query regressions now prove provider-clock-only derivation and stale temporal
  fact removal.
- Passed the final scoped importer/query suites, affected typechecks and importer
  build, docs drift, scenario integrity, privacy scan, and `git diff --check`.
- The mechanically merged candidate passed 223 provider, 171 importer, 21 query,
  105 device-sync service, and 32 core reconciliation tests; affected package
  typechecks/builds and required CI also passed. A current-main merge-tree proof
  remained clean after the base advanced again.
- The PR architecture schema now passes with its explicit complexity-avoidance
  item. The runner bundle budget-policy suite passes 42 tests, and exact local
  production assembly passes at 9,952,950B total and 7,927,638B static closure
  with the existing narrow allowances retained.
- Round eight found that precise sparse corrections could leave old daily sums
  stale and that the unconditional calendar import had widened hourly work to
  all configured resources across seven days. Focused tests reproduce both
  mechanisms and now prove exact-interval plus daily correction, six-resource
  one-day hourly work, and retention of the once-daily broad sweep.
- Passed all 223 Junction provider, 105 device-sync service, 171 Junction
  importer, and 21 normalized wearable query tests; the device-sync typecheck,
  docs drift, scenario integrity, and production runner assembly also pass. The
  final runner bundle is 9,955,082B against the 9,985,718B budget.
- Round nine found that a UTC-normalized sparse correction window could refresh
  no date or the wrong date when the corrected interval belonged to a
  negative-offset provider day. The regression now proves that canonical
  provider-day evidence selects April 2 for an April 3 UTC execution window,
  deduplicates two corrected rows on that date, and waits until the exact UTC-12
  closure boundary before issuing the daily refresh.
- Passed the exact remediation's 223 Junction provider and 105 device-sync
  service tests, the device-sync typecheck, docs drift, scenario integrity, and
  production runner assembly. The runner bundle is 9,956,920B against the
  9,985,718B budget.
- Pending: commit/push, exact-head CI, ReviewGPT PASS, merge, and worktree
  retirement.
