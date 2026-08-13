# `@murphai/importers`

Workspace-private ingestion adapters for documents, meals, explicit CSV sample ledgers, and provider snapshots. Importers may parse inputs and prepare metadata, but they must route all canonical writes through `@murphai/core`.

Adding a new wearable provider? Pair the importer work with the transport half described in `docs/device-provider-contribution-kit.md` at the repo root, and use the scaffolds listed in `docs/templates/README.md` so the provider lands through both seams together.

## Baseline Scope

- `document` import reads file metadata only and forwards a normalized document payload.
- `meal` import inspects photo/audio attachments and forwards a normalized meal payload.
- `samples` CSV import parses tabular sample rows and forwards an explicit raw/debug sample-ledger batch payload.
- Clinical FHIR planning is available only from `@murphai/importers/clinical-records`; it stays off the broad importer root and hosted cold-start path until a clinical intake owner wires that explicit seam.
- No OCR, transcription, or structured lab parsing is performed in the baseline.

## Built-in Device Providers

`createImporters()` and `prepareDeviceProviderSnapshotImport()` ship with built-in adapters for `whoop`, `oura`, and `strava`. Garmin data is supported exclusively through the `junction` provider.

Provider transport stays separate from normalization. Each adapter accepts one provider snapshot, preserves only provider evidence that is needed for replay or product facts, and promotes fields that fit the current canonical device batch surface. High-frequency provider telemetry should be reduced in memory to compact display-grade events or metric facts instead of being persisted as full sample arrays.

Junction keeps its existing daily timeseries summaries as the compatibility surface. For `glucose`, `blood_oxygen`, and `stress_level`, the importer also derives one deterministic 24-hour feature envelope and one measurement of scalar facts per source/day; coverage and episode durations are explicitly estimated from capped gaps between discrete readings. Only rows with a provider-supplied clock enter temporal derivation. Date-only rows remain in the established daily aggregates and produce a zero-coverage envelope with no invented hourly, overnight, rate, peak, or episode facts, so a later complete date-only response clears older temporal projections. Dense reconcile and direct-resource jobs both use the closed-calendar-day importer, so there is no precise-window path that can publish a partial day under a complete-day identity. Each scheduled reconcile refreshes the latest globally closed provider date for the six fidelity resources, while the existing account UTC-day gate retains the broader seven-day correction sweep across every configured timeseries resource. For sparse `caffeine`, `water`, and `mindfulness_minutes`, every admitted interval becomes one exact-start measurement with start/end qualifiers and compact per-record evidence. Precise direct-resource snapshots return bounded source/day correction targets in the canonical import receipt, and successful canonical import atomically persists one deduplicated resource continuation for each closed target through the existing device-job queue. Those retained jobs survive retry exhaustion and expired leases until a successful canonical calendar import; a later matching obligation renews the same row rather than replacing it. The calendar path is the sole writer of retained daily sums, so UTC-normalized execution windows cannot select the wrong provider date and an early partial set cannot freeze or block later records. Date-only transport preserves the provider-local calendar response instead of trimming it to UTC, and calendar-day imports wait until the date has closed even at UTC-12 before publishing, so a non-UTC source day stays complete. Daily sums and dense feature envelopes are unversioned complete-set facts: child-row revisions do not order the collection, serialized calendar imports reconcile complete-set growth or removal through the canonical event spine, and exact replays collapse. An ordinary empty provider collection emits no aggregate fact. A source-scoped sparse calendar repair treats HTTP 200 with an empty collection as an authoritative zero sum through that same event identity, clearing a displaced retained total; optional or unavailable endpoints remain retryable and do not claim success. Stable sparse intervals retain their explicit provider revisions; one versioned interval may migrate an earlier unversioned baseline, after which stale, changed unversioned, or equal-revision conflicting interval bodies fail closed. ID-less records keep semantic tuple identity. Both paths are bounded before persistence and never retain raw dense sample arrays.

The wearable raw ingest envelope is only a receipt: it stores the payload hash and the raw artifact roles for replay/audit, but it must not store another copy of the provider payload. Raw provider data belongs in the adapter's raw artifacts, and product/query surfaces should consume compact events, metric facts, or derived metric read models instead.

If a provider adapter returns a non-empty snapshot without any provider-owned raw artifacts, the import bridge adds one fallback `provider-snapshot` raw artifact before building the receipt. Adapters that intentionally drop dense provider payloads must sanitize those dropped sections or emit a tiny compact artifact first, so the fallback never re-stores the firehose under a generic role.

Built-in providers now share one descriptor surface in `device-providers/provider-descriptors.ts`. That descriptor is the single source for provider key, transport modes, OAuth paths/scopes, webhook support, default sync windows, metric families, and source-priority hints, so importers and `device-syncd` no longer drift on provider metadata.

The iOS companion's direct WHOOP overnight-HRV path is a deliberately narrower
Junction-account ingress rather than a fourth transport provider. It accepts
only the strict `murph.companion.overnight-prv-rmssd.v1` derived observation
and maps it to one immutable `whoop-ble-overnight-prv-rmssd` millisecond
summary per phone-scheduled local `00:00–08:00` occurrence. The accepted method
is `prv-rmssd-5m-mean-scheduled-0000-0800-local-v1`; frozen timezone rules keep
each scheduled occurrence stable. A fully traversed occurrence is bounded to
84...108 five-minute windows, typically 84/96/108 with intermediate counts such
as 90/102 for half-hour shifts. The canonical
identity is the night date; the verified admission digest and versioned
calculation method remain provenance, so retry cannot mint another nightly
fact. Raw R-R intervals, BLE frames, exact capture timestamps, per-window
values, WHOOP account identity, every band identifier, and Apple
Health comparison values are outside this package's contract. iOS may retain
one protected scalar night checkpoint, at most three strict-envelope outbox
entries, and the exact app-scoped CoreBluetooth peripheral UUID needed to
restore the enrolled band. That UUID never uploads or enters logs; none of this
local state is an importer or backend scheduler concern. Apple HealthKit's generic HRV input maps
separately to canonical `hrv-sdnn`; the importer never combines SDNN or generic
provider `hrv-rmssd` with the companion PRV series. Its provider external
identity remains stable across that metric correction so a re-import supersedes
an older generic Apple HRV event instead of duplicating it.

For the next provider, importers should only need:
- one shared descriptor entry
- one adapter under `src/device-providers`
- tests that prove descriptor and adapter alignment

Auth, webhook preflight/admin behavior, token storage, and hosted control-plane
wiring stay outside this package. Importers own normalization only.

## Core Integration Seam

This package still supports an injected write port for tests and alternate callers, but its default workspace wiring now targets the concrete `packages/core` exports.

The assumed core surface is:

- `importDocument(payload)`
- `addMeal(payload)`
- `importSamples(payload)`

Importers never write vault files directly. They validate inputs, inspect source files, normalize payloads, and delegate the final canonical mutation to the injected core port.
