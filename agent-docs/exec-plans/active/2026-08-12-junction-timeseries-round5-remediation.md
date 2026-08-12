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
  CI, and the next exact-head ReviewGPT round pass.

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
5. [ ] Complete local verification, commit and push the exact candidate, then
   run required CI and ReviewGPT to a clean stopping condition.

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

## Verification

- Passed focused store-level regression proving pre-closure suppression,
  higher-priority resource completion, and post-closure daily import.
- Passed focused query regression proving same-max set growth, lower-max set
  removal, paired daily/feature publication, and exact-replay collapse.
- Passed all 222 Junction provider tests, all 162 Junction importer tests, and
  all 19 normalized wearable-surface tests.
- Passed affected `core`, `importers`, `device-syncd`, and `query` typechecks,
  the importer build, scenario-manifest integrity, and `git diff --check`.
- Reproduced ReviewGPT round six's proposed 11,522-event historical batch and
  proved it fails the base branch's pre-existing 10,000-output integration
  ingest contract; no out-of-scope contract expansion was retained.
- Pending: docs drift, final privacy/diff review, exact-head CI, and ReviewGPT
  round seven.
