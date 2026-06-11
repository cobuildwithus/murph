# Device Import ExternalRef Idempotency

Created: 2026-06-10
Status: completed

## Problem

Hosted Junction imports duplicate the same provider records massively (one WHOOP
workout appeared 11×; one sleep session 143×; ~4,100 duplicate events across a
hosted vault). Root cause chain, proven against hosted raw-ingest receipts and
manifests:

1. `importDeviceBatch` event identity is a deterministic content hash that
   includes `accountId` (`packages/core/src/mutations.ts`,
   `normalizeDeviceEventInputs`). Dedupe is "exact id already in target shard".
2. Junction's import `accountId` (`jxn_acct_*`) is derived from the local
   device-sync account row id (`buildJunctionImportAccountId(context.account.id)`),
   which is a random `dsa_*` id minted on registration.
3. The device-sync SQLite store is `machine_local` and hosted runners are
   ephemeral, so every cold start re-registers the account with a fresh row id
   → fresh `jxn_acct_*` → fresh event ids → every overlapping trailing-window
   poll re-appends already-imported events.

`agent-docs/operations/device-sync-ingestion-invariants.md` invariant 4 says
"Merge is idempotent on `externalRef.resourceId`. Core upserts on the record's
own resource id" — push/pull overlap safety (invariants 2–3) depends on it, but
core never consulted `externalRef`. The duplicate events all share an identical
stable `externalRef`. This change makes invariant 4 actually true.

## Changes

1. `packages/core`: in `importDeviceBatch`, reconcile prepared device events
   against the latest live ledger records by `externalRef`
   (system/resourceType/resourceId/facet) within the target shards before
   building the append plan:
   - identical content (ignoring `id`, `rawRefs`, `lifecycle`, `recordedAt`) →
     skip append;
   - changed content → append an event-spine revision reusing the existing
     event id (append-only preserved, reads collapse via spine);
   - no match / no `externalRef` → current behavior.
2. `packages/device-syncd`: derive `buildJunctionImportAccountId` from the
   stable provider `externalAccountId` instead of the per-registration local
   row id, so import identity survives hosted cold starts.
3. Tests for re-import idempotency across differing accountId/raw paths,
   spine-revision update on changed content, and unchanged no-externalRef
   behavior.

## Decisions from deep review

- `externalRef.version` is NOT part of the reconcile identity: WHOOP/Oura/
  Strava stamp it from the record's mutable `updated_at`, so keying on it would
  mint a new event per provider rescore. Version still participates in content
  equality, so version bumps with changed data become spine revisions.
- Supersede revision numbers come from the max revision across ALL stored rows
  of the matched event id (not just ref-bearing rows), so a user edit that did
  not echo the externalRef can never collide with an import revision.
- Device events are provider-owned: a changed provider re-delivery supersedes
  with pure provider content and may drop user-added fields on that event.
  Accepted explicitly; durable user context belongs in notes/journal, not in
  edits to imported device events.

## Accepted residual risks

- Cross-month occurredAt drift on a re-import misses the shard-scoped match
  and duplicates once.
- The Junction accountId migration changes deterministic ids once: junction
  samples (no externalRef reconcile) can duplicate one generation in
  overlapping windows post-deploy, and previously deleted junction events can
  resurrect once under a new id. Both converge immediately and fold into the
  deferred duplicate cleanup.
- Stored rows that fail strict contract parse are skipped by the reconcile
  index (lenient, unlike findEventByExternalRef); a legacy unparseable row can
  yield one self-healing duplicate.
- Supersede revision numbering is shard-local: a user edit that moves a device
  event's occurredAt to a different month writes its revision to another shard,
  and a later changed re-delivery can append a colliding revision number in the
  original shard (read-side winner falls to the recordedAt tiebreak).
- Each import reads target event shards twice (reconcile index + append-plan
  id scan); acceptable at monthly-shard sizes.

## Out of scope

- One-time hosted vault cleanup of existing duplicates (runs as vault-only data
  work via existing delete/spine primitives, not a repo change).
- Sample-stream dedupe (Junction summary resources emit events; revisit if a
  provider emits duplicated samples).
Updated: 2026-06-10
Completed: 2026-06-10
