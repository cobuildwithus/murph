# Device Sync Ingestion Invariants

Last verified: 2026-07-12

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

4. **Merge is idempotent on `externalRef.resourceId`.** Core reconciles on the
   record's own resource id (the explicit Junction id for summaries;
   resource/source/timestamp for timeseries). Push-then-pull re-imports of
   identical content are skipped, and changed content appends an event-spine
   revision of the same event id (read-side revision collapse keeps one live
   record), so importing a record more than once — or via a different path —
   is overlap-free. This is what makes invariants 2 and 3 safe, and it is why an
   import-vs-skip optimization is unnecessary: re-fetching is cheap and correct,
   not a correctness risk.

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
