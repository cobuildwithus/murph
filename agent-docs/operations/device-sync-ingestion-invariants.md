# Device Sync Ingestion Invariants

Last verified: 2026-08-14

## Purpose

These are the load-bearing invariants for how `device-syncd` ingests provider
data through both push (webhook direct-import) and pull (windowed fetch). They
exist because the recurring device-sync defect class was silent data loss: a
path-selection or "usefulness" gate decided *import-vs-skip* and the skip arm
quietly completed without importing or fetching anything.

The ingestion model is now additive: push and pull are complementary, neither
gates the other, and no branch can complete without import-or-fetch. Treat the
seven invariants below as constraints that any change to webhook construction,
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
   webhooks can never starve or defer the floor. Projection does not own source
   admission: it rereads the live source rows and does not mutate a
   `disconnected` source. Pulls retain the complete upstream provider list for
   provenance resolution, then reread admission immediately before each
   durable summary or timeseries import and remove records for disconnected
   sources. While any source is pending admission, unresolved source-reference
   identities fail closed. A provider with no source row remains admitted for
   legacy accounts.

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
   new canonical output, receipt state, or evidence identity. When a repeated
   multi-part delivery changes only some evidence, the new ingest row retains
   only those novel parts and only their output-role links under a distinct
   per-delivery incremental-evidence marker inspected with the original
   delivery ids. The marker is only a locator: it cannot authorize a no-op or
   repair from incomplete proof. Missing canonical outputs fail closed before
   reconciliation; otherwise the existing novelty owner proves every incoming
   evidence fingerprint, receipt, and output link. When that proof is missing
   or unsafe, ingestion fails open by retaining one complete received evidence
   set, after which the next replay converges. A repair delivery also
   retains the complete received evidence set rather than trusting damaged
   historical proof. A batch whose novel evidence cannot be associated with
   its accepted prepared event, or whose prepared events share one canonical
   owner, likewise remains complete so later repair cannot lose the
   evidence-role mapping needed to reject ambiguity. Evidence for a newly
   appended event revision is always retained even when identical evidence
   bytes were seen before. An
   integrity-invalid exact row repairs once under the deterministic
   association-revision id. A live shard whose
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

   Compact Junction timeseries retain that same single-owner rule. Dense
   `glucose`, `blood_oxygen`, and `stress_level` reconcile and direct-resource
   jobs both use closed provider-calendar-date imports; a precise window must
   not publish a partial day under the daily fact or 24-hour feature identity.
   A provider calendar date becomes publishable only after it has closed at
   UTC-12, so UTC midnight cannot freeze a partial negative-offset source day.
   Only dense rows with a provider-supplied clock contribute temporal samples.
   Date-only rows remain daily aggregate inputs and publish a zero-coverage
   feature envelope without fabricated hourly, overnight, rate, peak, or
   episode facts, allowing a complete response to clear older temporal facts.
   Sparse `caffeine`, `water`, and `mindfulness_minutes` direct-resource jobs
   retain precise windows because each admitted interval has its own exact-start
   identity, but those precise snapshots emit intervals only. The canonical
   import receipt returns the provider-local day keys that own those intervals.
   When an accepted stable-row correction moves an interval between provider
   dates, the transient receipt includes both the displaced and incoming day.
   Before the precise job completes, it atomically converts every closed
   affected date into one deduplicated existing `resource` job. Each job owns
   exactly one resource/provider date and retries that existing calendar-day
   importer independently, so a failed date, a later correction, or a runtime
   yield cannot erase or restart accepted refresh work. Setup, account, source,
   and credential-epoch transitions keep that same job dormant without
   provider I/O and wake it when authority returns. A calendar job completes
   only when the canonical import receipt names its exact source/resource/day
   daily identity. A successful exact-source HTTP 200 empty response applies
   an explicit zero through that identity; a nonempty response that normalizes
   to no owned daily state stays retryable. The exact calendar-repair snapshot
   also fails before the canonical write if its provider-scoped response is
   structurally incomplete or any target row lacks a valid value, interval,
   source identity, or provider day. Non-object groups or samples cannot be
   silently discarded into a partial set or fabricated authoritative empty
   response, so one surviving row cannot certify a partial complete-set
   revision. The calendar path uses the existing Junction connect-route owner
   to compare provider aliases at authority and response-selection boundaries,
   queries the route's canonical target, and projects selected rows onto the
   account's established persisted source key and provider spelling before
   strict import. Routine calendar imports, direct dense imports, precise sparse
   corrections, and retained calendar repairs all perform that same projection;
   none derives a replacement source key from an execution-local account id.
   If legacy state contains route-equivalent duplicate rows, the oldest keyed
   row wins deterministically so retries remain bounded and stable. Core rejects more than
   64 affected dates before its canonical write, and the provider repeats that
   bound before queue fanout. That path is the sole writer of their
   daily sums, so a UTC-normalized execution window cannot select the wrong provider
   date and a growing precise set cannot
   create an immutable partial aggregate or block a later interval. Every
   scheduled reconcile refreshes the latest globally closed date for the six
   fidelity resources. The account's existing UTC-day gate retains the broader
   seven-day correction sweep across all configured resources without turning
   the hourly floor into an all-resource fanout. Daily sums and dense feature
   envelopes describe a complete
   resource/day collection, so a maximum child-row revision must not version or
   order that set. Serialized complete-calendar imports reconcile those
   unversioned facts through the canonical event spine, where exact replays are
   no-ops and later non-empty set growth or removal remains revisionable. An
   ordinary empty provider collection emits no aggregate tombstone, so it cannot
   delete a previously published fact outside the exact-source calendar repair
   exception above. Explicit
   provider revisions belong only to stable sparse interval identities. One
   versioned interval may supersede a pre-versioning baseline; after that, only
   a strictly newer revision may change it, while stale replay is a no-op and
   conflicting equal or unversioned interval content fails closed. Fetch-side
   fidelity dedupe must preserve provider calendar-date and timestamp-semantics
   differences so those conflicts reach this importer-owned comparison in
   either response order. This keeps
   each compact resolution consistent without a second cursor, watermark,
   queue, schema, or state owner; the already-durable device-job row is the
   calendar-refresh obligation.

5. **Louder, never quieter.** Drops and skips surface as persisted
   `device-sync.job_failed`/skip metadata. But observability is not recovery:
   the persisted signal exists to explain *why*, while the floor (invariant 1)
   is what actually recovers the data. A change may make ingestion louder
   (more imports, more visible skips); it must never make it quieter (a new
   silent skip, a deferred floor, a gated import).

   Eligible hosted webhook imports emit a best-effort
   `device-sync.import_completed` runtime log after the canonical job succeeds.
   At ingress, the new timing fields on the existing dirty-resource carrier
   reduce provider event time to a coarse event-to-send delay bucket, compute
   the verified signed-envelope send-to-receipt duration, and preserve the
   earliest Murph receipt long enough to derive receipt-to-import duration
   after import. A timing-only source field carries attribution without
   participating in dirty-resource identity, counters, provider job payloads,
   or executor routing; execution `sourceProviderSlug` retains its existing
   meaning. This reduction applies to the timing carrier and runtime log;
   pre-existing ingestion fields still use provider occurrence for dirty-window
   and clean-transition wake ownership. Coalesced hints
   keep the slowest upstream bucket, longest signed delivery, and earliest
   receipt without pairing timestamps from different events. Source attribution
   coalesces only when every timing hint agrees; conflicting sources are omitted.
   The runtime log contains only the coarse upstream bucket, connector provider,
   normalized source provider when known, job kind, provider-send-to-receipt,
   receipt-to-import, queue, and execution durations. `provider` names the
   executor/transport owner, while `sourceProvider` distinguishes Garmin,
   Fitbit, and other Junction-backed sources and falls back to the connector for
   direct integrations or unknown Junction sources. It deliberately omits raw
   stage timestamps, event/resource semantics, counts, and exactly reversible
   event-origin intervals. Missing or negatively ordered clocks omit only the
   affected measurement. The runtime timing association is pass-local, so a
   compact job that remains queued or retrying beyond its admitting pass can
   later succeed without a completion event. This telemetry is buffered and
   cannot delay acceptance, import, or the pull floor; it is not a recovery
   owner or an exhaustive import ledger.

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

   Junction timeseries history follows the exhaustive static policy beside the
   provider executor. Dense daily aggregates (`blood_oxygen`, `stress_level`,
   `hrv`, `respiratory_rate`, and `glucose`) retain the bounded 14-day initial
   window. Sparse daily aggregates (`afib_burden`, `vo2_max`,
   `heart_rate_recovery_one_minute`, body and basal temperature resources,
   `sleep_breathing_disturbance`, `caffeine`, `water`, and
   `mindfulness_minutes`) use the summary-history window, 180 days by default.
   Every date-mode timeseries request owns one complete provider calendar date,
   so offset timestamps on opposite sides of UTC midnight reach the importer
   together during both migration and normal reconcile. A provider-bearing date
   with any row rejected by the canonical aggregate parser retries only that
   date on the existing bounded ladder before it becomes terminal.
   Historical-pull status is re-read at the first date and before
   coverage. Source matching canonicalizes supported connect-route aliases on
   both the persisted and introspection sides before applying the status table:
   A matching pulled entry owns contradictory envelopes: `success` permits
   terminal empty history, nonterminal state waits, and explicit failure remains
   uncovered. Explicit `not_pulled` is no obligation only without a pulled entry.
   Unavailable, malformed, or unmatched introspection can close only after a
   canonical historical observation. Before coverage closes, the
   migration recomputes the live reconcile-window boundary and appends the
   uncovered segment; delayed continuations repeat that same derivation, so
   stable dedupe cannot freeze a middle gap.
   Blood pressure and notes retain their existing extended policies. An
   explicit timeseries-window override governs both classes.

   Extended work is admitted only for a persisted connected source that
   advertises the exact resource. Each `(source provider, resource)` migration
   keeps the existing one-day fetch continuation and per-account serialization.
   Rollout-added resources end at the current UTC day so existing connections
   receive one migration; blood pressure remains anchored to source first-seen
   time. Source-scoped completion is stored in connection metadata. All extended
   timeseries resources share one fixed-width, versioned source-by-resource
   matrix in an existing blood-pressure or note coverage slot. Its append-only
   route slots cover every configured Junction source within the 256-character
   scalar bound, and deployed blood-pressure and note values remain legacy read
   inputs. An unrepresentable route fails before history egress instead of
   advancing coverage. Blood pressure retains exact per-reading repair and notes
   retain complete-fetch semantics. No second queue, retry store, or persisted
   lifecycle owns this history.

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
   account writes. Hydration and hosted job-time source listing resolve Junction
   sources by semantic provider identity, retain the established local source
   key and spelling, and use one source-state consolidation rule: the newest
   valid `lastSeenAt` owns status, errors, and availability, equal-timestamp
   lifecycle conflicts fail retryably, and `lastDataAt` merges independently as
   monotonic arrival evidence. An accepted reconnect therefore replaces an
   older fence before its first new payload without discarding historical
   arrival evidence, so hosted/local keys or timestamps cannot create competing
   source owners. Future aggregate-progress ownership comes
   from the versioned status scalar rather than today's window fields; opaque
   future progress and evidence remain unchanged while canonical webhook import
   continues.
   Disconnect captures its connection and credential epoch atomically, then
   rechecks `connectedAt` and OAuth `tokenVersion` under the existing mutation
   lock. Setup-failure cleanup similarly compare-and-sets the captured
   `updatedAt` epoch. Seeded connection flows carry that same revision in their
   one-time state and recheck it inside the existing upsert transaction, so an
   old callback cannot adopt, replace, or fail a newer reconnect. Stale work
   therefore cannot clear a newer local connection or token. A replacement
   `connectedAt` epoch also supersedes every connection-epoch-scoped durable
   effect: Web revalidates webhook admission and clears old fetch/control dirty
   work under the connection lock and dirty-marker row lock, while runtime
   hydration retires matching queued, retryable, and leased jobs inside the
   credential-replacement transaction. Already accepted import carriers that
   do not consume the replaced connection credentials remain pending:
   Oura/WHOOP/Strava tombstones, companion HRV and health metadata, and Junction
   summary payloads whose inline source provenance is sufficient for direct
   import. Inline-looking Junction jobs that must fall back to a provider fetch
   remain connection-epoch scoped. Junction owns that exact inline predicate
   beside its importer-backed executor. Web derives the same authority while
   preparing each encrypted dirty payload and persists only the resulting
   boolean beside the ciphertext. The dirty store privately completes
   compression, secure-box sealing, and any lazy Junction classifier load
   before a store-owned transaction; callers cannot supply prepared bundles.
   Consent-gated webhook and companion admissions first use a short member and
   connection/source authority transaction, then do payload-bearing work outside
   every database lock through a request-local non-serializable store capability.
   Their final transaction reacquires the same admission locks, re-reads consent
   and exact connection/source authority, and consumes the capability only if
   the dirty-marker snapshot and, for payload work, device-domain root are
   unchanged. Compact-only webhook hints do not mint a dirty crypto capability:
   the preflight reads only whether the marker is expected to cross clean-to-dirty,
   the canonical dirty store owns the final in-transaction update and actual
   revision, and only an unexpected clean transition triggers a full replan.
   Exact source admission reads use the connection id, provider slug, connected
   status, and disconnect-fence predicate in SQL and return at most one minimally
   projected candidate per check instead of hydrating connection-wide history.
   Clean-to-dirty mailbox crypto is prepared outside the locks and revalidates
   its exact ingress root in the final transaction. One fresh-cache full replan is allowed on
   preparation drift, including the shared domain-root mismatch emitted by the
   mailbox owner; repeated drift fails retryably. Built-in webhook providers
   admit at most two dirty resources in one delivery (the Junction connection
   event is the maximum), while companion admissions carry exactly one. Web
   rejects a larger provider batch before admission so the composed preparation
   and transaction bound cannot grow silently. A withdrawal that commits
   during preparation therefore prevents every durable payload, receipt, signal,
   trace-completion, and wake mutation. On a replacement epoch, the ordinary non-null path uses only a marker
   compare-and-set plus set-based deletion of rows classified as
   credential-scoped. Nullable rows left by mixed-version writers are the one
   transitional exception: Web classifies at most 800 of them inside the
   existing member-row transaction, after the health-data consent re-read and
   after locking the dirty marker, so completed withdrawal orders before any
   legacy decryption and both reconnect and acknowledgement take the marker
   before touching payload rows. More than 800 null rows fail retryably until
   runtime acknowledgement reduces that backlog.
   Hosted runtime
   hydration still loads the classifier per turn and passes it into the existing
   SQLite credential-replacement transaction. Both paths keep provider/importer
   modules out of their static boot closures. Recovery does not use an automatic export endpoint, operator
   action, or vendor support.
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
   standard HRV quantity is SDNN (`hrv-sdnn`); the direct WHOOP 5/MG BLE result
   is a beta overnight pulse-rate-variability RMSSD estimate
   (`whoop-ble-overnight-prv-rmssd`) with no generic `hrv` or biomarker alias.
   The existing provider resolver continues to select at most one daily
   `hrv-rmssd` point across WHOOP Recovery, Oura, and other provider evidence.
   The beta companion series does not compete or aggregate with either series.

   After one explicit enrollment, the phone continuously subscribes to the
   WHOOP 5/MG pulse-interval stream and owns a fixed `00:00–08:00` local
   civil-time schedule. It freezes the timezone rules for each night, so later
   timezone changes cannot move a retained occurrence. A fully traversed night
   is bounded to 84...108 completed five-minute windows: typically 84, 96, or
   108, with intermediate counts such as 90 or 102 for half-hour transitions.
   It reduces intervals into non-overlapping windows with
   method `prv-rmssd-5m-mean-scheduled-0000-0800-local-v1` and uploads only the
   strict six-field nightly envelope: `schema`, `methodVersion`, `nightDate`,
   `rmssdMs`, `completedWindowCount`, and `acceptedWindowCount`. Exact capture
   timestamps, duration, timezone details, coverage milliseconds, raw packets,
   intervals, packet timestamps, device identifiers, and per-window values
   never enter ingestion. The phone owns the per-window accepted-duration
   policy; web verifies the closed summary shape, at least 48 accepted windows,
   and at least 50% accepted completed windows.

   The backend owns no capture scheduler. iOS may persist only one protected,
   schema-versioned scalar checkpoint containing the frozen night/schedule
   identity, next window position, completed/accepted counts, and accepted
   RMSSD sum, plus an outbox of at most three already-derived strict envelopes.
   First admission accepts night dates from three UTC dates behind through one
   UTC date ahead, so all three outbox entries remain admissible when the
   member's local date trails UTC without uploading a timezone.
   The exact app-scoped CoreBluetooth peripheral UUID may persist in that
   protected state solely to restore the enrolled band; it never enters
   ingestion or logs. An incomplete window is discarded across a process gap;
   raw intervals, partial-window state, per-window values, WHOOP account
   identity, and every other band identifier remain memory-only. One continually
   postponed local watchdog notification may remind the member to reopen Murph
   when callbacks stop. Normal backgrounding needs no nightly action, but
   force-quit prevents BLE relaunch until the app is opened again.

   Local direct-BLE enrollment and hosted Junction authority are separate. The
   Connect WHOOP control enrolls only the CoreBluetooth band and does not send
   hosted `connect`. Known same-member passive SDK repair sends `resume`; a
   fresh or unproven installation omits intent and lets durable server state
   decide. Exactly one established provider row resumes, zero provider rows may
   establish the first lane, and terminal or ambiguous state rejects without
   mutation. Only a future visible hosted-health/Junction Reconnect action may
   send `connect` and create/reactivate the lane. Data ingress and retry-outbox
   drain likewise carry no connection lifecycle authority.

   The first strict envelope owns `(connection, nightDate)` in a 30-day,
   64-row-per-connection receipt window. Exact replay is a no-op and changed
   content conflicts. Every accepted envelope carries a verified SHA-256
   admission identity from encrypted web staging through local dedupe and
   importer external identity. Receipt cardinality is connection plus
   `nightDate`; canonical cardinality is vault plus source (`whoop`) plus
   `nightDate`. That produces one immutable summary-grain event with a
   synthetic 12:00Z `occurredAt`, no event `timeZone`, and no reconstructed
   capture time.

   The encrypted hosted payload remains authoritative until canonical import
   succeeds, including across runtime yield, cold restore, lease expiry,
   disconnect, and hosted refetch. Canonical-owner failures retain and reclaim
   the same local retry row beyond the ordinary attempt fence; they never mint
   replacement dead rows or a tight hosted replay loop. Only canonical success
   or the exact structurally invalid terminal result acknowledges the hosted
   payload. Generic provider rows keep their existing executed-success or
   terminal-failure acknowledgement policy. While provider revocation is in
   flight, `DISCONNECT_IN_PROGRESS` still rejects runtime connection, local
   state, credential, source, and heartbeat mutations under the connection
   lock, without cancelling already accepted credential-free import work.

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
