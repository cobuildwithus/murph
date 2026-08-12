# Reconcile Junction compact timeseries collections

Status: active
Created: 2026-08-12
Updated: 2026-08-12

## Goal

- Resolve the accepted ReviewGPT findings on PR 1707 without adding another
  cursor, watermark, scheduler, or state owner.

## Success criteria

- Every scheduled reconcile reaches the bounded closed-calendar importer even
  when earlier resource jobs have advanced the account completion clock.
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
6. [ ] Remove round seven's synthetic-midnight temporal derivation, complete
   local proof, commit and push the exact candidate, then run required CI.
7. [ ] Record the hard-cap retrospective and obtain an explicit continuation
   decision before any eighth ReviewGPT round.

## Decisions

- The scheduled pull floor is unconditional; closure belongs to the calendar
  importer, not to an account-global completion timestamp.
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
- Pending: final commit/push, exact-head CI, and the explicit post-hard-cap
  ReviewGPT continuation decision.
