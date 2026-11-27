# Preserve clinical revisions on identical retrievals

Status: completed
Created: 2026-11-27
Updated: 2026-11-27

## Goal

- A daily reread of a clinical resource whose content matches the active
  canonical record writes no event revision and counts as nothing new. Today a
  resource without `meta.lastUpdated` takes the retrieval's `fetchedAt` as its
  revision, so every daily generation supersedes every unchanged record.

## Success criteria

- An identical reread without `lastUpdated` leaves the event ledger unchanged
  and reports zero created, superseded and retracted records.
- A correction supersedes, a withdrawal retracts, a retrieval older than the
  active revision stays stale, and a same-revision conflict is still rejected.
- Resources with a real `lastUpdated` behave as before.
- Derived document and structured facts stay bound to a live parent revision.
- The Epic lifecycle keeps event shards and revision counts identical across
  two unchanged daily generations, and the new tests fail with the fix reverted.

## Scope

- In scope: the importer's revision marking, the core canonical writer's skip,
  structured enrichment parent binding, tests and owner docs.
- Out of scope: cleanup of redundant revisions already in vaults, per-retrieval
  raw snapshots and change receipts, and a persisted retrieval order.

## Constraints

- Technical constraints: core owns the active revision and content comparison;
  reuse the existing clinical receipt content key rather than a new normalizer.
- Product/process constraints: synthetic data only; no ReviewGPT round for this
  handoff; draft PR only.

## Risks and mitigations

1. Risk: an unchanged reread no longer advances the stored revision, so a
   delayed retrieval dated between the active revision and that reread looks
   newer than the active revision.
   Mitigation (fix round): connections are unique per directory entry, not per
   FHIR server, and `fetchedAt` is run creation time, so this can happen. The
   skipped read's enrichment job is held by the source-equality gate below, and
   the next read of the resource restores current content. A strict fence would
   need persisted retrieval order, which is new state.
2. Risk: a document's attachment bytes change while its FHIR JSON does not, and
   facts from the old bytes survive.
   Mitigation: parents with downloaded attachments keep a revision per
   retrieval, so the old facts are invalidated as before.
3. Risk: structured enrichment for a later retrieval no longer finds a parent
   at that retrieval's revision and holds the source.
   Mitigation: a retrieval-dated source binds to the earlier active revision
   only when that revision's stored resource equals the job's, and then reuses
   its existing fact; otherwise it holds.
4. Risk (review finding): the content key misses source changes outside the
   canonical note (narrative, `doNotPerform`, `isSubpotent`), so an obsolete
   derived fact stays active.
   Mitigation: the snapshot import keeps the mark only when every cited source
   resource, excluding `meta`, equals the active record's stored resource.

## Tasks

1. Add `retrievalRevision` to the event import and clinical plan decisions.
2. Mark retrieval-dated upserts, withdrawals and holds in the importer, except
   parents with downloaded attachments.
3. Skip a marked newer upsert whose clinical receipt content key equals the
   active record, and a marked withdrawal of an already withdrawn record.
4. Bind retrieval-dated structured enrichment to the active revision.
5. Prove with importer, core, enrichment and PostgreSQL lifecycle tests, and
   with the fix reverted.

## Decisions

- The check lives in core's event import reconciliation, beside the existing
  same-revision replay skip, because core holds the active record and already
  compares retrieval-independent content. The importer only says whether a
  revision came from the retrieval, since that is what it knows.
- Content equality uses `clinicalReceiptContentKey`, the key that already
  decides whether a revision is a member-visible change, so "no revision" and
  "no change" agree. After review, the skip also requires source equality,
  proven in `confirmUnchangedClinicalSources` from the manifest-attested raw
  pages both records cite.
- History notes add `doNotPerform`, `isSubpotent` and `subpotentReason`. An
  unchanged source at an unchanged revision keeps its stored note instead of
  conflicting, so the new fields appear at the next source revision.
- A partial run that changed nothing reports `ready_partial` unless the runtime
  stopped its import (`snapshot_rejected`, `cursor_cycle`, `invalid_fhir_page`).
- A changed attachment behind unchanged document metadata is a content change:
  the parent takes the new revision so derived facts match the bytes.
- Existing redundant revisions are left alone. Readers collapse a spine to its
  latest revision, so they cost storage only; a cleanup would rewrite
  append-only history for no member-visible gain.

## Verification

- Commands to run: focused Vitest for importers, core, vault-usecases and
  assistant-runtime clinical suites; the lifecycle suite through
  `scripts/run-postgres-tests.mjs --worker-files` with
  `MURPH_TEST_POSTGRES_CONCURRENCY=1`; package typechecks, Web lint,
  complexity and docs checks.
- Expected outcomes: all pass with the fix; the new assertions fail with it
  reverted.
Completed: 2026-11-27
