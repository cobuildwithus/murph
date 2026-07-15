# Device Sync Ingestion Invariants

Last verified: 2026-07-14

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
   First-write canonical results use the same authorized prepared outputs as
   evidence association: an association-safe current owner or an event actually
   appended by the operation. Exact no-ops intersect that same current-owner
   authorization with the validated stored event-output ids. A raw-only row
   whose stored event outputs are empty therefore returns `events: []`, even
   when another current record owns the incoming external ref; a manual edit or
   tombstone is not counted as a newly canonical import, and the result never
   exposes an ambiguous input draft or distinct replacement owner. For a closed gzip/ZIP shard,
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
   `sleep_cycle` from fresh availability and Junction historical-pull state.
   Recognized SDK sources such as Apple Health participate independently of the
   Link-only provider filter. Availability is capability evidence, not proof
   that sparse resources such as workouts or body measurements should contain a
   row, so those resources do not become absence obligations.

   The importer is the sole owner of raw summary semantics. Historical coverage
   consumes the bounded `(source provider, resource)` normalization evidence
   emitted by the canonical adapter instead of maintaining a second metric
   parser. Junction historical-pull state is authoritative when available:
   `success` completes an obligation even with zero rows and provider-specific
   ranges, while `not_pulled` creates no obligation. Scheduled, in-progress,
   retrying, unknown, malformed, or unavailable state remains pending. Bounded
   canonical normalization evidence and authenticated old-window push evidence
   are the fallback when introspection is unavailable.

   The versioned scalar in connection metadata owns aggregate coverage status,
   attempt count, and the daily observation cadence across every unresolved
   source; there is no per-source retry state or second retry store. A
   nonterminal source keeps that aggregate status `retrying` at the saturated
   daily cadence even when another source has reached a provider-specific
   recovery outcome. The durable reset-required fact belongs to the Garmin
   connection-source row. Once the shared observation ladder is saturated, an
   explicit `failure` for every still-pending Garmin obligation may set
   `HISTORICAL_DATA_RECONNECT_REQUIRED` on that source while aggregate metadata
   remains `retrying` for another provider. Successful Garmin historical
   coverage clears the Garmin marker independently; it does not complete or
   defer another source's cadence. Current ingestion and late canonical webhook
   import remain active in every state.

   Hosted execution hydrates the control plane's persisted connection-source
   rows before running provider jobs, so an empty provider response can still be
   attributed to the source the member connected. At the hosted authority
   boundary, aggregate metadata and source recovery rows are applied according
   to those separate owners in the same connection epoch. Aggregate `retrying`
   cannot suppress a saturated Garmin marker, and aggregate `exhausted` is not a
   prerequisite for that marker. Existing connection and source version fences
   reject stale updates before either owner advances. Restarting the Garmin
   export is an explicit member choice through the existing settings flow:
   confirm the connection-wide disconnect, then reconnect Garmin. That reset can
   disconnect other wearables on the same Junction connection, so the UI and
   assistant must explain the scope before confirmation. If provider-side
   deregistration fails, local disconnect still completes, but the member must
   remove the connection in the Garmin account before reconnecting.
   That unfinished-reset state rides the disconnected connection's existing
   durable error code (`HISTORICAL_RESET_REVOKE_FAILED`), so the settings and
   connect surfaces keep projecting the manual-removal guidance across refresh
   until a fresh established connection clears it; there is no separate warning
   store. Junction source-only writes carry the same connection-epoch fence as
   account writes. Hydration resolves Junction
   sources by semantic provider identity and lets an accepted reconnect epoch
   replace older local source state, so hosted/local keys or timestamps cannot
   create competing source owners. Future aggregate-progress ownership comes
   from the versioned status scalar rather than today's window fields; opaque
   future progress and evidence remain unchanged while canonical webhook import
   continues.
   Disconnect captures its connection and credential epoch atomically, then
   rechecks `connectedAt` and OAuth `tokenVersion` under the existing mutation
   lock. Setup-failure cleanup similarly compare-and-sets the captured
   `updatedAt` epoch. Seeded connection flows carry that same revision in their
   one-time state and recheck it inside the existing upsert transaction, so an
   old callback cannot adopt, replace, or fail a newer reconnect. Stale work
   therefore cannot clear a newer local connection or token. Recovery does not
   use an automatic export endpoint, operator action, or vendor support.
   Hosted runtime account hydration keys by the control plane's opaque hosted
   connection id before mutable provider identity. A terminal privacy scrub
   therefore updates the same local account instead of leaving the old account
   runnable. An unbound legacy account with unsanitized identity may be adopted
   through its unique provider-plus-external-account match. Once a terminal
   privacy scrub leaves only opaque identity, fallback adoption requires one
   exact provider-plus-connection-epoch candidate. If an older runtime already
   has one original-plus-opaque fork for that tuple, hydration transactionally
   moves its sources and jobs onto the hosted-bound row and deletes the
   credentialed orphan. Additional or opaque siblings, provider changes, and
   collisions with a second account fail closed.

7. **HRV method semantics survive import and reprojection.** HealthKit's
   standard HRV quantity is SDNN (`hrv-sdnn`); direct WHOOP spot RMSSD is
   `hrv-rmssd`. Every accepted direct-WHOOP canonical observation carries a
   verified SHA-256 admission identity from web staging through local dedupe and
   importer external identity. The admission identity, not the reusable client
   capture id, owns canonical idempotency after receipt retention expires.
   Its encrypted hosted payload remains authoritative until canonical import
   succeeds, including across runtime yield or cold restore. That success gate
   is companion-specific. Generic provider payload rows remain available to
   reconstruct a lost machine-local queue while work is queued, but the
   checkpoint handoff carries the local scheduler's future wake instead of
   immediately replaying the hosted row. Generic execution success or terminal
   failure acknowledges the row. Work skipped after a machine-local disconnect
   remains hosted until the next control-plane snapshot either restores the
   active account and replays it or explicitly terminally dispositions it;
   companion RMSSD acknowledges only canonical success. Canonical-owner
   failures retain the same local job row, extend its attempt fence, and use
   the existing bounded retry delay even after ordinary job attempts are
   exhausted. An expired worker lease on that fenced row is reclaimed on the
   same row rather than dead-lettered, and a hosted refetch dedupes to that row
   before reclaim; these paths never create replacement dead rows or an immediate hosted
   replay loop. A structurally invalid companion payload terminalizes its one
   local job and acknowledges the exact encrypted hosted payload so it cannot
   replay into replacement dead rows. While provider revocation is in flight, the web-owned
   `DISCONNECT_IN_PROGRESS` sentinel rejects every runtime connection, local
   state, credential, source, and local-heartbeat mutation under the connection lock.
   A replay after mutable vault-timezone metadata changes preserves the first
   canonical `dayKey` and `timeZone`; that placement drift alone is duplicate
   content, while every other same-admission content difference remains an
   immutable conflict.
   Re-import preserves the provider external identity while correcting the
   metric, and query reprojection classifies unreimported generic Apple HRV
   facts from source provenance as SDNN without promoting them into RMSSD
   summaries.

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
