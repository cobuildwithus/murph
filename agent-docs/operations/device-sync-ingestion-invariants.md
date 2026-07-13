# Device Sync Ingestion Invariants

Last verified: 2026-07-10

## Purpose

These are the load-bearing invariants for how `device-syncd` ingests provider
data through both push (webhook direct-import) and pull (windowed fetch). They
exist because the recurring device-sync defect class was silent data loss: a
path-selection or "usefulness" gate decided *import-vs-skip* and the skip arm
quietly completed without importing or fetching anything.

The ingestion model is now additive: push and pull are complementary, neither
gates the other, and no branch can complete without import-or-fetch. Treat the
six invariants below as constraints that any change to webhook construction,
resource-job execution, or scheduled reconcile must preserve.

These are durable behavioral invariants. The current owning code lives in
`packages/device-syncd/src/providers/junction.ts` (Junction is the reference
implementation and the only push-primary provider today), with the generic
drain/batch service seam in `packages/device-syncd/src/service.ts`.

## Invariants

1. **Pull is a floor, not a fallback.** The scheduled `reconcile`/`backfill`
   pass fires on cadence unconditionally. It is the sole owner of source
   projection (`projectJunctionSources`), so `last_seen_at` stays fresh even
   when only direct imports are happening. Non-floor completions may move
   `nextReconcileAt` only *earlier* (min-only clamp), never later; a stream of
   webhooks can never starve or defer the floor.

2. **Push delivers early; pull guarantees eventually; neither disables the
   other.** A webhook that carries a parseable payload imports inline (early,
   no fetch). The floor still runs later and refetches the same window. Because
   the merge is idempotent (invariant 4), this overlap is free — so there is no
   exclusivity logic deciding which path "wins."

3. **Unknown input degrades to fetch, never to silence.** Any webhook branch
   that has "nothing to import right now" — empty payload, unknown
   discriminator, oversized payload, unconfigured resource with no event-type
   fallback — marks the connection dirty for the floor (a coalescible reconcile
   over the event window). No silent-complete terminal branch exists: every
   webhook branch ends in import, fetch, or a scheduled floor reconcile.
   The degrade reconcile coalesces on a day-floored window dedupe key, so a
   burst of such webhooks collapses to one floor wake. (Expected edge: a burst
   straddling 00:00 UTC can floor to two days and produce two reconciles —
   harmless, since invariant 4 makes the extra fetch idempotent and Junction
   reads are unmetered.)

4. **Merge and storage are idempotent on `externalRef.resourceId`.** Core reconciles on the
   record's own resource id (the explicit Junction id for summaries;
   resource/source/timestamp for timeseries). Push-then-pull re-imports of
   identical content are skipped, and changed content appends an event-spine
   revision of the same event id (read-side revision collapse keeps one live
   record). Before content reconciliation, core recognizes a strictly matching
   exact delivery by its current id, its metadata-and-importer-receipt-aware
   legacy id, or a deterministic association-revision id. The stored evidence,
   receipt, event-role associations, sample ids, and their current physical
   owners must all match before the delivery can suppress a write. An exact,
   complete delayed-v1 replay is therefore a no-op after a v2 correction, user
   edit, or tombstone. If a later attempt carries evidence that is novel or must
   be retained in a new month, core may append one self-contained raw-only row,
   but it does not relink the protected canonical owner and the next identical
   attempt is a no-op. Missing output state is restored, and an equivalent
   changed canonical owner receives an append-only association revision instead
   of mutating history. A valid exact ingest's stored event output supplies the
   canonical spine id when a missing event must be recreated; ambiguous
   multi-event mappings fail closed instead of minting content-derived ids, and
   outputs attributable to current or protected prepared events are reserved
   before any missing-event assignment. A
   different or deleted replacement owner is not relinked
   to stale evidence. For unversioned provider events, the in-memory event scan
   recognizes previously delivered content as historical; comparable newer
   source versions still flow through normal canonical reconciliation.
   Historical primary-ref entries retain their event-spine owner during that
   scan only when the incoming content fingerprint was previously delivered by
   that owner. A delayed replay therefore resolves after a later revision moves
   its current external ref, while a distinct event that legitimately reuses
   the old ref does not inherit that owner; legacy aliases do not bypass their
   normal compatibility checks.
   Evidence association requires a physically current owner or an event append
   completed by this operation; unresolved planning eligibility alone cannot
   authorize an association. An intentionally raw-only row still converges when
   its prepared deterministic id is physically occupied by a corrected owner.
   The exact-id
   check reads a live shard backward from its append
   tail and ordinarily stops after 8 MiB or 64 complete rows. If the newest row
   itself crosses 8 MiB, the reader may finish only that row, bounded by the 128
   MiB journal-row limit plus its preceding delimiter. A tail miss may perform
   one authoritative target-shard scan whose result is reused by append
   planning; it never performs a second full id scan. Core separately
   suppresses a repeated row and audit when the same provider account has no
   new canonical output, receipt state, or evidence identity. Each written
   device delivery retains its complete received evidence set, so its validity
   never depends on an older novelty row. An integrity-invalid exact row repairs
   once under the deterministic association-revision id. A live shard whose
   final complete row lost only its newline receives exactly one delimiter
   before the new row; an incomplete final row rejects the append. Malformed
   newline-framed history may retain one novel delivery only after a tolerant
   full scan proves that no requested id is conflicting or invalid; a requested
   JSON id token inside a malformed row is conservatively treated as invalid.
   Returned canonical events likewise include only physically current or newly
   appended records, never an ambiguous raw-only input draft. For a closed gzip/ZIP shard,
   novelty uses the existing bounded archive reader because the amended
   representation remains archived and cannot create a live-tail proof.
   Missing, corrupt, unmatched oversized, or out-of-budget history fails open
   by retaining one copy. A replay that first crosses a month boundary is
   likewise retained once and then
   dedupes in that new month. Changed and raw-only evidence remains durable. Thus
   importing a record more than once — or via a different path — is overlap-free
   without making polling responsible for deciding what to discard. This is
   what makes invariants 2 and 3 safe, and it is why an import-vs-skip
   optimization is unnecessary: re-fetching is cheap and correct, not a
   correctness risk.

5. **Louder, never quieter.** Drops and skips surface as persisted
   `device-sync.job_failed`/skip metadata. But observability is not recovery:
   the persisted signal exists to explain *why*, while the floor (invariant 1)
   is what actually recovers the data. A change may make ingestion louder
   (more imports, more visible skips); it must never make it quieter (a new
   silent skip, a deferred floor, a gated import).

6. **Historical completion is source/resource coverage, not account-level
   traffic.** A useful activity record cannot complete an advertised sleep
   obligation, and one connected source cannot satisfy another source's
   obligation. Junction connect-window backfills derive high-signal daily
   `(source provider, resource)` obligations for activity, sleep, and
   `sleep_cycle` from fresh availability. Availability is capability evidence,
   not proof that sparse resources such as workouts or body measurements should
   contain a row, so those resources do not become absence obligations. The
   coverage-policy version is encoded in the existing status scalar, alongside
   the existing bounded retry progress; there is no separate policy metadata
   field or second retry store. Garmin sends requested history asynchronously
   and incrementally through daily-data webhooks, so the bounded ladder observes
   for that arrival and late webhooks remain importable after `exhausted` ends
   polling. After an authenticated old-window webhook produces canonical events,
   one bounded, window-scoped scalar records exactly that source/resource proof.
   The existing deduplicated coverage verification unions the proof with fresh
   REST rows; complete late coverage clears the source error even when Garmin's
   REST sleep response remains empty. If Garmin coverage is still incomplete,
   only the pending source is marked reconnect-required while current ingestion
   remains active. Hosted
   execution hydrates the control plane's persisted connection-source rows
   before running provider jobs, so an entirely empty provider response can
   still be attributed to the source the member connected. Restarting the
   export is an explicit member choice through the existing settings flow:
   confirm the connection-wide disconnect, then reconnect Garmin. That reset
   can disconnect other wearables on the same Junction connection, so the UI and
   assistant must explain the scope before confirmation. If provider-side
   deregistration fails, local disconnect still completes, but the member must
   remove the connection in the wearable provider account before reconnecting.
   That unfinished-reset state rides the disconnected connection's existing
   durable error code (`HISTORICAL_RESET_REVOKE_FAILED`), so the settings and
   connect surfaces keep projecting the manual-removal guidance across refresh
   until a fresh established connection clears it; there is no separate warning
   store. At the hosted authority boundary, coverage metadata and the source
   reset signal are one coupled decision: legacy runners cannot replace
   current/future progress, reset-required is valid exactly while progress is
   `exhausted`, and a stale participating source rejects the account transition
   for retry from a fresh snapshot. Junction source-only writes carry the same
   connection-epoch fence as account writes. Hydration resolves Junction
   sources by semantic provider identity and lets an accepted reconnect epoch
   replace older local source state, so hosted/local keys or timestamps cannot
   create competing source owners. Future ownership comes from the versioned
   status scalar rather than today's window fields; opaque future progress and
   evidence remain unchanged while canonical webhook import continues.
   Disconnect captures its connection and credential epoch atomically, then
   rechecks `connectedAt` and OAuth `tokenVersion` under the existing mutation
   lock. Setup-failure cleanup similarly compare-and-sets the captured
   `updatedAt` epoch. Seeded connection flows carry that same revision in their
   one-time state and recheck it inside the existing upsert transaction, so an
   old callback cannot adopt, replace, or fail a newer reconnect. Stale work
   therefore cannot clear a newer local connection or token. Recovery does not
   use an automatic export endpoint, operator action, or vendor support.

## Consequences for changes

- Do not reintroduce a usefulness/import-vs-skip gate on the webhook path. The
  downstream normalizer decides meaning; the ingestion layer's only job is to
  import every parseable record under its own resolved source provenance, or
  degrade to the floor.
- Do not add `projectJunctionSources` to the direct-import path. Projection
  rides the floor only, preserving the deliberate `user/providers` decoupling.
- Push-primary cells (Garmin sleep/sleep_cycle, deletions/tombstones) rely on
  inline import being authoritative because REST is stale or empty for them.
  Never remove their inline import "carrier"; the floor fetch is best-effort
  there and may legitimately return empty.
- Per-resource webhook recovery must coalesce on the shared dirty-state key
  (one floor wake per clean→dirty transition), not emit a unique-window job per
  webhook, so bursts do not fight storm-coalescing.
- Do not replace historical coverage with a single `has any records` flag, a
  per-resource job fan-out, or another retry store. The exact-window job,
  scalar connection metadata, and provider-owned bounded ladder are the one
  recovery path.

## Related docs

- `docs/device-provider-compatibility-matrix.md` — per-family pull/push
  expectations and the push-primary column.
- `docs/device-sync-hosted-control-plane.md` — hosted control-plane direction.
- `agent-docs/RELIABILITY.md` — reliability guardrails and failure-mode policy.
