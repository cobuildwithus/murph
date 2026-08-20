# Device Sync Hosted Control Plane

Last verified against repo layout: 2026-08-16

## Current split

Murph's hosted device-sync stack is now split this way:

- `apps/web` is the canonical hosted control plane. It owns durable hosted device-sync facts in Postgres, including connection ownership, OAuth/session state, short-lived hosted connect intents, token-audit history, sparse sync signals, per-connection dirty state for webhook freshness, local-agent sessions, and the web-owned internal runtime snapshot/apply/connect-link/reconcile/dirty-state/pending/ack routes.
- `apps/cloudflare` is the hosted execution plane only. During a hosted job it may call narrow signed web callbacks to fetch the current device-sync runtime snapshot, apply runtime updates, or start a provider connect link, but it is not a second durable device-sync control plane.
- `apps/cloudflare` also owns encrypted, non-canonical Queue transport for provider webhook bursts. Queue and its encrypted DLQ are delivery buffers only; they own no connection, trace, dirty, consent, lifecycle, or health fact.
- local `device-syncd` remains the data plane that talks to provider APIs, normalizes provider payloads through `@murphai/importers`, and writes canonical health records into the local vault.

This is the live repo shape, not a future rollout plan.

## Shared ingress seam

`@murphai/device-syncd/public-ingress` remains the reusable callback and webhook core shared across local and hosted surfaces. It owns:

- provider connect URL creation
- OAuth state validation
- OAuth callback handling
- provider webhook verification and parsing
- duplicate webhook trace suppression
- dispatch into store-specific side effects

That seam is reused by:

- local `device-syncd` when operators expose or tunnel callback and webhook routes
- the hosted Next.js control plane in `apps/web`

It does not own canonical health-data import, token authority, or canonical hosted control facts.

## Hosted responsibilities

### `apps/web`

`apps/web` is responsible for:

- provider connect UI and authenticated settings routes
- OAuth start and callback routes
- public webhook routes
- provider-account ownership mapping through blind indexes plus opaque connection ids
- durable Postgres-owned connection summaries, webhook traces, token-audit history, sparse wake signals, per-connection dirty aggregates, and agent-session state
- token export and refresh flows for the local agent
- disconnect, pairing, and other hosted operational control flows
- the signed internal runtime snapshot, runtime apply, dirty-state fetch/pending/ack, and connect-target link routes consumed by hosted execution
- validation and durable mailbox handoff for hosted manual reconcile requests

`apps/web` must not:

- expose raw provider tokens to browsers
- become a canonical health-data store
- write health records into the vault directly

### `apps/cloudflare`

`apps/cloudflare` is responsible for:

- signed Temporal `ensure-processing` handling, per-user Durable Object coordination, and bounded hosted workspace invocation drive
- invoking signed internal `apps/web` callbacks when a hosted job needs current device-sync runtime authority
- consuming current runtime snapshots during a hosted job and sending narrow runtime updates back to web
- durably accepting ciphertext-only device-webhook envelopes and returning decrypted deliveries to Web in signed, sequential, size-bounded batches

`apps/cloudflare` must not:

- become the durable owner of hosted device-sync token escrow
- maintain a second canonical runtime snapshot store for device sync
- replace `apps/web` as the device-sync control plane

### Local `device-syncd`

Local `device-syncd` remains responsible for:

- local token cache and reconcile state
- scheduled reconcile and backfill execution
- direct provider API fetches for configured direct providers such as WHOOP, Oura, and Strava, plus Junction-backed targets such as Garmin when configured
- normalization and import through `@murphai/importers`
- all canonical vault writes for wearable data

## Trust boundary

### Hosted boundary

The hosted boundary may hold:

- provider client credentials
- per-user connection metadata and token-audit history in Postgres
- sparse webhook traces, wake signals, and dirty connection aggregates
- execution-time runtime snapshots and runtime updates passed across signed internal callbacks during a hosted job

The hosted boundary must fail closed on auth and never gain canonical vault-write authority.

### Local boundary

The local boundary may hold:

- a local cache of provider tokens
- local reconcile state and import history
- local sync schedules
- the vault path and canonical write capability

Local agents authenticate to hosted APIs with a server-to-server credential tied to one Murph user account and never shared with the browser runtime.

## Durable state placement

### Postgres in `apps/web`

Postgres remains required for hosted device sync because Vercel does not provide stable local disk for:

- OAuth state round-trips
- connection ownership mapping
- public connection metadata and token-audit history
- webhook dedupe and device-sync dirty coalescing
- sparse wake signals
- local-agent pairing and session records

Recommended durable tables remain:

- `device_connection`
- `device_token_audit`
- `device_oauth_session`
- `device_connect_intent`
- `device_webhook_trace`
- `device_sync_signal`
- `device_sync_dirty_connection`
- `device_sync_dirty_payload`
- `device_sync_companion_capture_receipt`
- `device_agent_session`
- optional `device_webhook_subscription`

Postgres should keep only opaque ids, blind indexes, typed summaries, sparse signals, audit history, dirty resource/window summaries, and the canonical hosted runtime authority consumed by the internal snapshot/apply/dirty-state/pending/ack routes. It should not store canonical health facts.

### Bursty webhook transport

For providers explicitly listed in `HOSTED_DEVICE_WEBHOOK_QUEUE_PROVIDERS`, the
public Web route first decides Queue eligibility from the provider gate and
bounded raw-body size. Oversized bodies use the existing synchronous path. An
eligible request verifies the provider signature and parses the exact body once,
then freezes that authenticated meaning as the explicit versioned
`murph.device-sync-prepared-webhook.v1` contract without reading Postgres. The
raw signature headers and body are not queued. Web seals only that prepared
event under a one-message ingress root wrapped to the existing Cloudflare
automation P-256 recipient, then calls the OIDC-authenticated Cloudflare enqueue
route. Provider success is returned only after `Queue.send` confirms durable
acceptance. A failed or ambiguous enqueue never falls through to synchronous
admission; provider redelivery converges through the existing provider-scoped
trace identity. Neither path invokes the provider verifier twice.

The OIDC control boundary projects Queue-ingress failures through a closed,
value-free stage code. The code distinguishes malformed or unsafe visible
metadata, hosted-crypto environment mismatch, unavailable recipient keys,
root-key unwrap failure, authenticated-payload open failure, persistence-key
selection, resealing, Queue availability, and `Queue.send` rejection. It must
never serialize the caught exception, envelope, key id or material, provider
payload, account, event, or trace identity. Web retains the stage only as the
allowlisted log `type`; the public provider response keeps the generic retryable
Queue-enqueue code. Provider rollout remains disabled
until the exact deployed Web and Worker pair completes this transport contract;
a failed canary is rolled back to the synchronous path before investigation.

The Queue consumer is configured for 100 messages, five-second collection,
one consumer, ten retries, and an encrypted DLQ. It decrypts outside Postgres
and normally sends each delivery as one signed Web callback of at most 100
messages. It partitions only when the exact UTF-8 callback would exceed the
2 MiB Web body contract, so individually valid large events remain admissible.
Web validates the whole callback, groups prepared events by provider account,
and runs at most four independent account lanes. One account remains ordered
and serial. Each event acquires its existing trace-processing lease only when
that exact event starts durable admission. Web never preclaims later events in
an account lane, so a callback deadline or process termination cannot leave
not-yet-started events waiting on five-minute processing leases. Web does not
re-run the provider signature verifier or parser.
The frozen receipt instant and parsed meaning therefore survive provider secret
or parser rotation while queued; the trace processing lease begins at Web
admission time so a delayed delivery never starts with an expired lease. Every
emitted prepared schema decoder must remain readable through the maximum Queue,
DLQ, and redrive horizon, just as an old transport recipient key remains
decrypt-only during its retention window.

Transport admission is batched; durable database ownership remains per event.
Trace admission, health-data consent, provider-application revision, setup,
source, reconnect, disconnect, dirty state, exact encrypted payload, mailbox
wake, trace completion, and post-commit Temporal behavior retain their existing
per-event authority checks and independently retryable transactions.
Cloudflare consumer concurrency remains one, so the four-lane Web bound is also
the composed database-concurrency bound for this Queue. Value-free batch logs
report input, lane, disposition, failure-code count, and duration totals; they
never include account, trace, transport, provider payload, or exception values.
No Queue database, Durable Object state, Vercel Workflow, Temporal webhook
workflow, or cross-event processing lease is introduced.

The historical three-account five-minute peak was 2,675 events; its 10x model
is 26,750 events (about 89/s average and 222/s in the peak minute). At 200 ms of
per-event durable work, the old serial path takes about 89 minutes. Four evenly
loaded lanes approach 22 minutes, but the observed top account carried about
65% of the five-minute peak, so preserving its order puts the conservative
lower bound near 58 minutes. At 500 ms/event,
the corresponding bounds are about 56 minutes when evenly loaded and 2.4 hours
at the observed skew instead of 3.7 hours. These are service-time bounds, not a
production latency guarantee: connection authority, consent, locks, crypto,
dirty persistence, mailbox and signal work remain part of every exact event.
A one-account storm remains serial because parallel writes to the same
member/connection lock would amplify contention and cannot safely reorder exact
resource work. The throughput gain therefore comes from fewer signed Vercel
callbacks and bounded progress across independent accounts, not from acquiring
database authority for future same-account events.

Queue-visible state contains random transport identifiers, ciphertext, and key
wrap metadata only. Provider, account, event, trace, and prepared job meaning
remain inside the secure box; provider signature headers and raw request bodies
are discarded after initial verification. Tamper, unknown key, unsupported
prepared schema, malformed envelope, callback ambiguity, and every failed Web
admission retain the individual encrypted message for retry and eventual DLQ.
Only accepted and duplicate dispositions acknowledge a message; failures cannot
be dropped without a separate durable quarantine owner.

`device_connect_intent` stores short-lived first-party Murph connect claims for hosted assistant-initiated wearable linking. The signed internal connect-link route returns only the first-party `/device/connect/:claim` URL to the runner. Opening that URL requires the authenticated Murph app session for the same member before provider OAuth starts. The hosted browser start also requires its configured provider callback base to use that request's hostname; a mismatch fails before OAuth state creation or provider authorization. Start sets a short-lived provider-, state-, member-, and session-bound host-only proof. The provider callback GET validates that proof, passes `expectedOwnerId` into shared ingress, and redirects back into the app without an interstitial. A missing proof burns the OAuth state and returns to Connect so the callback URL cannot be relayed. Intent rows must not store raw provider or Junction authorization URLs.

`device_sync_dirty_connection` is the coalescing point for high-cardinality device webhook backfills. It is keyed by hosted connection ID and tracks `dirty_revision`, `processed_revision`, first/latest dirty timestamps, widened safe windows, compact resource/source counters, and a compact `dirty_resources_json` map. It must not store raw provider request bodies, provider tokens, raw samples, or user-visible health facts. Provider-owned durable webhook work, such as Junction direct data or exact resource/delete/deauthorization jobs needed for later import, is event-triggered work and is stored in `device_sync_dirty_payload` as bounded encrypted/compressed payload rows until the runtime consumes and explicitly acknowledges those row ids. Each new row also stores one server-derived `credential_independent` boolean beside the ciphertext. Store-owned dirty writes classify, compress, and seal before their transaction. Consent-gated webhook and companion admissions first check consent plus exact connection/source authority in a short transaction, prepare through a request-local non-serializable dirty-store capability outside all locks, then reacquire the admission locks and require unchanged consent, authority, dirty-marker snapshot, and, for payload work, device-domain root before persistence. Clean-to-dirty mailbox crypto follows the same outside-lock preparation and exact ingress-root revalidation. One fresh-cache full replan is allowed on drift; repeated drift fails retryably. A withdrawal that commits while preparation is in flight leaves no durable payload, receipt, signal, trace-completion, or wake. During mixed-version rollout the bit is nullable. The steady-state reconnect path reads no payload and resets the compact marker plus deletes credential-scoped rows with set-based writes. Nullable legacy rows are the other bounded consent-ordered path: reconnect classifies at most 800 inside the existing member transaction after locking and re-reading health-data consent and then locking the dirty marker. Acknowledgement takes that same marker-before-payload order, preventing a reconnect/acknowledgement deadlock. A larger null backlog fails retryably until runtime acknowledgement reduces it.

The companion overnight PRV lane reuses that encrypted payload owner. Its only
public health payload contains `schema`, `methodVersion`, `nightDate`,
`rmssdMs`, `completedWindowCount`, and `acceptedWindowCount`, with method
`prv-rmssd-5m-mean-scheduled-0000-0800-local-v1`. iOS owns the continuous BLE
subscription and fixed local `00:00–08:00` schedule. A fully traversed frozen
occurrence is bounded to 84...108 five-minute bins, typically 84/96/108 with
intermediate counts such as 90/102 for half-hour shifts. The hosted control
plane owns no capture scheduler, sleep detector, per-window rows, or phone checkpoint.
`device_sync_companion_capture_receipt` owns one accepted strict envelope per
`(connection, nightDate)` for exact replay; it retains only
the member/connection binding, hashed receipt id, envelope hash, and creation
time. Receipts expire after 30 days, are capped at 64 per connection, and are
excluded from workspace snapshots. They never contain exact capture timestamps,
capture duration, timezone offset, coverage milliseconds, raw BLE packets,
R-R intervals, packet timestamps, device identifiers, or per-window values.
This receipt cardinality is operational only; canonical import independently
owns one immutable summary per vault, `whoop` source, and `nightDate`.

The companion sign-in route separates local band enrollment from hosted
lifecycle authority. The direct-BLE Connect WHOOP control enrolls only the
CoreBluetooth band and sends no hosted `connectionIntent: "connect"`. A known
same-member passive SDK repair sends `connectionIntent: "resume"`. A fresh or
unproven installation omits intent and lets durable server state decide:
exactly one established row resumes, zero provider rows may establish the first
lane, and terminal or ambiguous state rejects without mutation. Only a future
visible hosted-health/Junction Reconnect action may send `connect` and create or
reactivate the lane. Omitted intent can never reverse a durable disconnect.
The iOS-only protected checkpoint, exact app-scoped CoreBluetooth peripheral
UUID, and outbox bookkeeping never enter Postgres or the hosted workspace; only
an individual strict six-field envelope is uploaded through the derived-data
route. The UUID never uploads or enters logs.

Native account admission is separate from both band enrollment and hosted
device lifecycle authority. `POST /api/device-sync/companion/admission`
accepts only an optional validated IANA time zone, reuses the canonical hosted
member consent/trial/access owner, and returns only `{ "ok": true }`. Its
public Android recovery boundary preserves the stable login, consent, access,
suspension, and alternate-sign-in identity-conflict outcomes. All other
retryable owner failures normalize to `COMPANION_ADMISSION_RETRYABLE`; all
remaining terminal setup failures normalize to
`COMPANION_ADMISSION_SUPPORT_REQUIRED`. The client may retry only the former
and must stop automatic admission attempts on the latter, while internal
hosted lifecycle codes remain private. The route's static dependency graph is
kept outside device-sync public ingress. A consented fresh companion activation
with a verified phone may enter the canonical signup-welcome path under the
existing exact-member binding, signup idempotency, home-line health, and
proactive-capacity owners. A healthy line sends the normal conversational
welcome and keeps its existing bounded three-day unfinished-setup continuation;
the companion does not also send the separate Web signup email. If no line is
assignable or proactive capacity cannot be reserved, companion activation
completes without a route and
inbound-first messaging remains available on a contacted managed line whose
existing reply-egress policy permits the exact active member's provider-attested
direct message. That path binds the home route and appends the encrypted input
atomically even when at-risk or delivery-warning posture excluded proactive
outreach; unmanaged, disabled, ambiguous, and unsafe lines cannot establish that
exact-line authority, and ordinary fallback selection fails closed when empty.
Web activation keeps its existing fail-closed requirement. The activation mailbox item is the durable retry
authority: a failed companion runtime wake returns the public retryable outcome,
and later admission or sign-in-token requests signal that exact unconsumed item
instead of creating a second activation or welcome. Sign-in-token is both a
direct companion entry point and a retry after committed activation, so it
returns the underlying retryable runtime-wake code and does not create a
Junction session until the wake passes. Admission creates, resumes, reactivates,
or otherwise mutates no Junction connection.

### Cloudflare execution state

Cloudflare storage keeps hosted execution coordination state only, such as encrypted hosted workspace bundles, opaque runner residue, and other execution-plane metadata described in `ARCHITECTURE.md`.

When a hosted job needs device-sync access, Cloudflare must call the signed internal web routes to:

- fetch the current runtime snapshot
- apply narrow runtime updates
- fetch pending dirty device-sync state as a first-class work source
- fetch a specific dirty device-sync revision when processing an explicit lifecycle wake
- acknowledge processed dirty revisions after checkpoint-safe execution
- start a provider connect link
- append a member-bound manual reconcile wake

That execution-time access does not make Cloudflare the durable owner of hosted device-sync authority.

### Local runtime

The local vault runtime keeps:

- local token cache
- reconcile and import history
- schedule and job state
- one opaque hosted-connection binding per local device account, used before
  mutable provider identity during snapshot hydration so terminal privacy
  scrubbing cannot fork an account; pre-binding legacy adoption requires one
  exact provider-plus-connection-epoch candidate. A recognized pre-v8
  original-plus-opaque fork is consolidated transactionally, preserving jobs
  and sources on the hosted-bound row while deleting the credentialed orphan;
  additional or opaque siblings, provider changes, and identity collisions
  fail closed

This local runtime remains the only place that writes wearable facts into the vault.

## API shape

### Hosted public routes

- `GET /api/device-sync/oauth/:provider/callback`
- `GET /api/device-sync/connect/:provider/callback`
- `GET /api/device-sync/webhooks/:provider`
- `POST /api/device-sync/webhooks/:provider`

These are internet-facing and provider-facing only. `:provider` is resolved through the shared provider-manifest registry, not an app-local provider list. Current configured providers include `junction`, `oura`, `strava`, and `whoop`; Junction-backed source providers such as Garmin are selected by connect target/source-provider metadata rather than by adding a separate hosted provider route.

### Hosted browser-facing connection routes

- `POST /api/connect-sources/:sourceId/start`
- `GET /device/connect/:claim`
- `POST /device/connect/:claim`
- `GET /device-sync/connect/complete`

These are the only browser-facing wearable connection start and completion routes. The settings start route resolves direct provider manifests and the connect-target catalog assembled by `@murphai/device-syncd/config`, so `/connect` can expose direct WHOOP/Oura/Strava targets plus Junction-backed Garmin/Fitbit-style sources when those providers are configured. The first-party `/device/connect/:claim` route is the hosted assistant confirmation path: GET renders login/confirmation state without mutating provider OAuth state, and POST starts provider OAuth only for the authenticated member that owns the claim. Every hosted browser start compares the resolved callback base with the authenticated request hostname before creating shared ingress; `DEVICE_SYNC_PUBLIC_BASE_URL` may change the path, but a split hostname is an operator error because both callback credentials are host-only. Provider callback GET requires the callback proof and active session, passes the member as `expectedOwnerId`, and redirects only after shared ingress verifies the OAuth-state owner; a missing or invalid proof burns the OAuth state and redirects to Connect without mutating.

Junction accounts created for their first Link start remain `pending_link` and
inert. They cannot admit webhook dirty work, runtime wakes, scheduled or manual
jobs, provider execution, import, or setup promotion. Proof-verified callback
completion is the only path to `source_confirmed`. Adding or retrying another Junction-backed
source on an established shared account preserves the account phase and sibling
sources. The target `DeviceConnectionSource` remains `disconnected`; target
webhooks and provider pulls stay inert until the hosted connection-established
hook commits that source, its signal, and mailbox work in one transaction.
Shared ingress explicitly selects `preserve_established` for a source addition
and `replace` for an account reconnect. The hosted Prisma owner and the local or
tunneled SQLite owner apply the same shared predicate inside persistence, so the
local adapter cannot re-pend the shared account or change its generation.
Shared ingress does not independently connect the source. If explicit
disconnect or a newer connection epoch wins the locked recheck, the callback
fails and the target remains disconnected. The start path retries provider
cleanup for that target source only and returns a retryable error rather than
issuing a new link when cleanup is ambiguous. Whole-account revoke remains the
explicit connection-wide disconnect path.

### Hosted settings-authenticated routes

- `GET /api/settings/device-sync`
- `GET /api/settings/device-sync/connections/:connectionId/status`
- `POST /api/settings/device-sync/connections/:connectionId/disconnect`

These are read/manage wearable routes for the hosted settings page. Ordinary reads should come from durable hosted metadata in Postgres. Live execution/runtime inspection belongs only on explicit operational routes.

### Hosted assertion-authenticated browser bridge routes

- `POST /api/device-sync/agents/pair`

These are browser-initiated but lower-level than the settings surface. They
must use short-lived signed assertions with the existing HMAC, member,
audience, method, path, and origin bindings plus single-use nonce replay
protection. The shared browser-assertion policy makes an integer-second `exp`
first invalid exactly at `(exp + 61) * 1000`; every earlier millisecond remains
admissible. New nonce rows persist that first-invalid instant, while request
admission performs one primary-key insert and treats only the exact nonce
conflict as replay. For mixed-version rollout, the bounded hourly
hosted-retention owner deletes only rows whose stored
`expiresAt <= now - 61 seconds`, retaining legacy raw-`exp` rows through the
full accepted window and intentionally retaining new-format rows for one extra
61-second interval.

### Hosted companion routes

- `POST /api/device-sync/companion/admission`
- `POST /api/device-sync/companion/sign-in-token`
- `POST /api/device-sync/companion/hrv-rmssd`

All are Privy-bearer-authenticated and consent-gated. Admission validates its
complete bounded optional-time-zone body before canonical member mutation and
uses the canonical signup-welcome route without suppressing trial activation;
it does not enter device sync. Sign-in honors the
resume, omitted-intent inference, and future explicit-connect authority split
above. The derived route accepts only the closed overnight summary contract,
reuses one active member-owned Junction connection, and never establishes or
reactivates a lane from data ingress.

### Hosted local-agent routes

- `POST /api/device-sync/agent/connections/:connectionId/export-token-bundle`
- `POST /api/device-sync/agent/connections/:connectionId/refresh-token-bundle`
- `POST /api/device-sync/agent/session/revoke`
- `POST /api/device-sync/agent/connections/:connectionId/local-heartbeat`

These are authenticated by local-agent credentials, not browser cookies.

### Hosted internal runtime/control routes

- `POST /api/internal/device-sync/runtime/snapshot` on `apps/web`
- `POST /api/internal/device-sync/runtime/apply` on `apps/web`
- `POST /api/internal/device-sync/runtime/dirty-state` on `apps/web`
- `POST /api/internal/device-sync/runtime/dirty-pending` on `apps/web`
- `POST /api/internal/device-sync/runtime/dirty-ack` on `apps/web`
- `POST /api/internal/device-sync/reconcile` on `apps/web`
- `POST /api/internal/device-sync/connect-targets/:connectTarget/connect-link` on `apps/web`

These routes are authenticated by signed server-to-server traffic that never reaches the browser. `:connectTarget` is resolved through the same connect-target registry used by `/connect`; the target carries the manifest provider plus optional Junction `sourceProviderSlug` such as Garmin, Oura, or Strava. The connect-link route creates a short-lived first-party connect intent and returns `connectUrl` plus a compatibility `authorizationUrl` copy of the same first-party URL; it does not start provider OAuth or return raw provider/Junction URLs to hosted execution. The reconcile route validates the member-owned active connection and appends one device-sync wake; the runtime then calls the existing `DeviceSyncService.queueManualReconcile` owner, so web does not duplicate provider scheduling policy or mutate connection schedule state. `apps/web` remains the canonical device-sync control plane while `apps/cloudflare` invokes only the narrow runtime callbacks it needs during hosted execution. Dirty-state callbacks are device-sync-specific; they are not a generic mailbox wake broker.

Runtime apply write-back is bounded to 100 distinct connection updates per
request. The hosted runtime splits larger legitimate results into sequential
batches, and web applies each accepted connection update sequentially through
its existing per-connection mutation lock and transaction. This bound prevents
one signed runtime callback from amplifying into unbounded concurrent database
transactions without introducing a queue, bulk mutation owner, or second retry
path.

### Runtime snapshot collection and credential hydration

The shared `@murphai/device-syncd/hosted-runtime` contract owns the snapshot
work ceilings. A snapshot page contains at most 32 connections, ordered by
`createdAt DESC, id DESC`. Web uses an immutable `(createdAt, id)` keyset
predicate and reads at most 33 rows, returning the last emitted row as
`nextCursor` only when the extra row proves another page exists. Caller limits
are advisory below the ceiling; larger values cannot increase SQL,
source-projection, or decrypt work.
A `connectionId` lookup remains an exact member-owned lookup rather than a
collection scan.

Credential-free pages use a distinct Prisma projection that does not select
`external_account_id_encrypted`, `access_token_encrypted`, or
`refresh_token_encrypted`, and they never enter the device-secret opener. They
retain the existing `opaque:<connectionId>` identity and redacted credential
shape. Credential-bearing runtime hydration follows pages sequentially and
fails closed if authority exceeds 100 connections, the existing runtime apply
ceiling. The reader omits the limit on its first request so the legacy Web
producer can return its complete snapshot; an omitted cursor is accepted only
on that first response and only within the 100-connection ceiling. Cursor-aware
responses use 32-row pages, and every continuing page must preserve explicit
cursor presence. Authority is never silently truncated.

Each page resolves connection sources through one set projection. The query
keeps provider/source alias matching, applies a hard 64-row per-connection
window plus one saturation detector, and rejects a saturated connection rather
than returning partial source authority. Eligible external-account and OAuth
token material is opened through the existing secure-box and domain-root
owners as page-scoped sets. A single scoped root-metadata read is reused across
the two device lanes, KMS unwraps remain chunked at four, AAD continues to bind
member, connection, provider, field/purpose, and token version, and every root
and plaintext buffer is zeroized. Missing or mismatched material fails closed;
database, KMS, and secure-box outages propagate as operational failures rather
than being rewritten as reauthorization. Application revision, refresh lease,
terminal/disconnect state, connection epoch, and provider/source authority stay
Web-owned and are preserved in the emitted snapshot.

Cloudflare only forwards the bounded request and cursor through the signed Web
callback. It does not persist a cursor, cache a page, hydrate secrets, or copy
this policy into the execution plane.

### Native companion status projection

Native companion status remains Privy-bearer-authenticated, consent-gated, and
member-isolated. After those checks, Web performs one narrow member-owned
Junction connection read selecting only `id` and `status` with a 32+1
saturation check, one bounded set source read for those ids with a 64+1
unscoped authority check or a narrower 32+1 source-filtered check, and one set
receipt-signal read. That bounded ledger includes data-bearing webhook receipts
and exact post-checkpoint canonical-import receipts. The path never selects or
decrypts an external account id or OAuth token. It preserves the
established active/not-disconnected predicates, source-scoped first-receipt
behavior, disconnected-source `lastSeenAt` receipt cutoff, resource alias
normalization, and timestamp-only response contract. Web remains the sole
device-sync control-plane truth owner.

Deploy the cursor-aware Cloudflare/assistant reader before the Web producer.
The reader-first version accepts the legacy complete response under the total
hydration ceiling; after Web deploys, the same reader follows the new bounded
cursor pages. Deploying the Web producer before the cursor-aware reader would
let a legacy transport discard continuation metadata and is therefore unsafe.

## Runtime access strategy

The current hosted runtime strategy is:

1. `apps/web` remains the durable owner of hosted device-sync control facts and runtime authority.
2. A hosted job running through `apps/cloudflare` requests the current runtime snapshot from the signed internal web route only when execution needs device-sync access.
3. The hosted runner fetches pending dirty device-sync rows from web-owned Postgres as a normal work source; webhook freshness does not depend on immutable per-webhook mailbox payloads.
4. The hosted job sends narrow runtime updates back through the signed internal web apply route.
5. Dirty revisions are acknowledged through the dirty-ack route only after the dirty state has been converted into local runtime work and that local work has crossed the checkpoint boundary. Exact payload rows stay hosted while their machine-local jobs are queued so a cold restore can reconstruct them, but the checkpoint result carries the local scheduler's future wake instead of immediately replaying retained work. A source-scoped resource job carries a bounded canonical-import receipt through that same checkpoint only when its canonical importer returned at least one canonical event and the job then completed; generic job success alone is not import evidence. When a no-import job schedules exactly one continuation, the local continuation link transfers the exact payload owner to that child and the recovery wake retains the association across cold restore. Web records the receipt only when the named payload row still exists, in the same short transaction that deletes the row, so exact callback replay cannot create duplicate freshness evidence. Generic rows acknowledge on executed local success or terminal failure. Work marked complete only because of a machine-local disconnect remains hosted until the next authoritative control-plane snapshot either restores the active account and replays it or explicitly terminally dispositions it. A verified companion overnight PRV row acknowledges only after canonical import success; canonical-owner failures and expired worker leases retain that same job beyond the ordinary attempt fence and follow the local scheduler's bounded future retry instead of creating dead replacement rows. A structurally invalid companion payload is different: its exact terminal code promotes the hosted payload acknowledgement after one dead local job so it cannot replay into unbounded replacement rows.
6. Local-agent token export and refresh flows stay on the hosted web boundary.
7. Cloudflare does not keep a second durable token-escrow source of truth for device sync.

This keeps control-plane truth in web while still allowing hosted execution to consume the runtime state it needs during a job.

The local device-sync SQLite schema is version 11. Its nullable
`device_job.canonical_import_completed_at` column is written atomically with job
success only after `importSnapshot` returns at least one canonical event and
survives cold restore until the post-checkpoint receipt is emitted. The
`device_job_continuation` relation records scheduled ownership handoffs; the
bounded recovery hint carries only the exact receipt context needed to restore
that ownership in a new workspace. A Cloudflare/runtime rollback below schema
v11 cannot open a workspace that has already advanced; recover with a forward
deployment rather than a binary downgrade.

Disconnect intent is also web-owned control-plane truth. Once the connection
mutation lock commits `DISCONNECT_IN_PROGRESS`, the signed runtime apply route
rejects every connection, local-state, credential, and source write for that
connection until the provider revoke finalizes; authenticated local heartbeats
receive the same retryable conflict without persisting sync timestamps. Dirty-payload acknowledgement
remains a separate path, so a companion import that already reached canonical
success may still acknowledge its exact hosted payload.

### Companion overnight deployment compatibility

Deploy runtime/Cloudflare first with immediate container rollout, verify its
runner-bundle fingerprint, and pass a compact import smoke. Deploy web second
with scheduled-method admission plus resume/omitted-intent/future-connect
authority, and distribute iOS last. The direct-BLE enrollment control sends no
hosted `connect`; web owns
known-member `resume`, fresh-install omitted-intent inference, and the future
visible reconnect authority. Before distribution, require a signed physical
iPhone WHOOP 5/MG continuous-subscription and overnight capture-to-query test
covering
background, reconnect, force-quit watchdog behavior, DST, and timezone changes;
network/log proof that forbidden raw data is absent; and paired-ECG validation
of the beta PRV method. Once scheduled-method clients ship, web and runtime
support are the rollback floor until those clients and staged envelopes drain.
Roll back in reverse order and let already-staged work drain before removing
runtime support.

## Webhook Dirty Coalescing

Webhook ingress separates level-triggered dirty hints from event-triggered durable webhook work. Provider parsers declare each webhook as either `level_dirty_hint` or `durable_webhook_work`; hosted dirty state must not infer that exact webhook work can be dropped. Level webhooks may be coalesced only after committed dirty state exists. Durable webhook work must be persisted or retried; it is never satisfied by dirty state alone.

Provider webhook traces remain exact for side-effect-bearing accepted deliveries. Accepted level dirty hints write sparse audit signals and upsert `device_sync_dirty_connection` only when they create fresh dirty work; later level hints for an already-pending connection can be accepted before trace claim. Durable webhook work still passes through exact trace claim and durable acceptance so provider-owned event work is not lost. The steady-state architecture does not use per-webhook hosted mailbox items or Vercel Workflows for freshness.

When a connection transitions from clean to dirty, webhook ingress commits the dirty state, appends one deterministic `device-sync.wake` mailbox handoff, and completes the trace in the same transaction. Additional level hints while already dirty are coalesced without another ingress wake. Durable webhook work appends independent encrypted payload rows under exact trace claim and is acknowledged by explicit payload row id, so concurrent durable deliveries do not need a connection-scoped acceptance lock. A retained generic payload follows the local job's retry wake and is removed after executed success or terminal failure, preventing both tight replay loops and dead-job recreation while preserving cold-restore reconstruction. A machine-local disconnect cannot release it; the next authoritative hosted snapshot decides active replay versus terminal disposition. A companion overnight PRV row stays pending through canonical local import so a yielded or restored runtime can refetch the authoritative encrypted observation. Dirty rows and remaining payload rows drain through dirty-pending and dirty-ack callbacks; there is no dirty-row recovery sweep. The existing scheduled mailbox-handoff sweep selects one unconsumed `device-sync.wake` pointer per user alongside its other durable mailbox candidates, so a failed first Temporal signal is retried from mailbox truth without a pending-handoff ledger or dirty-row scan. Webhook and app paths do not send runner nudges directly to Cloudflare.

Temporal is the only normal wake orchestrator. When mailbox signals or reconciliation facts show durable work, it calls Cloudflare's signed `ensure-processing` adapter; Cloudflare returns `runtime_processing_accepted` or `retry_later` and owns runner start, wake, active-fence alarm cleanup, and execution cleanup.

For accepted webhooks, provider trace completion means durable audit and dirty acceptance committed. Internal wake delivery is not allowed to force provider retry after that transaction commits. Existing connection-established and disconnect wakes remain immediate lifecycle commands because they are explicit lifecycle commands, not high-cardinality freshness hints.

## Provider and connect-target split

Provider configuration is registry-owned by `@murphai/device-syncd/config`. Hosted routes resolve provider manifests for direct providers and resolve connect targets for user-facing source choices. This keeps direct WHOOP, direct Oura and Strava, and Junction-backed source providers such as Garmin/Oura/Strava on one control-plane shape instead of branching hosted persistence by provider.

### WHOOP direct provider

Hosted responsibilities:

- OAuth callback
- webhook verification and dedupe
- blind-index account mapping
- hosted web token refresh and agent export flows
- execution-time runtime snapshot/apply access when a hosted job needs it

Local responsibilities:

- fetch WHOOP collections and resources directly
- import delete and resource changes into the vault from hosted hints

### Oura direct or Junction-backed target

Hosted responsibilities:

- OAuth callback
- hosted web token refresh and agent export flows
- webhook subscription management when Oura webhooks are enabled
- Junction connect-target link generation when Oura is routed through Junction
- execution-time runtime snapshot/apply access when a hosted job needs it

Local responsibilities:

- polling-first reconcile against recent windows
- optional use of hosted webhook signals
- local imports into the vault

### Strava direct or Junction-backed target

Hosted responsibilities:

- OAuth callback
- hosted web token refresh and agent export flows
- app-global webhook preflight and dedupe when direct Strava webhooks are enabled
- Junction connect-target link generation when Strava is routed through Junction
- execution-time runtime snapshot/apply access when a hosted job needs it

Local responsibilities:

- polling-first reconcile against recent activity windows
- optional use of hosted webhook signals
- local imports into the vault

### Garmin via Junction

Hosted responsibilities:

- Junction connect-target link generation with Garmin carried as the Junction source provider
- hosted web token refresh and agent export flows through the Junction provider manifest
- execution-time runtime snapshot/apply access when a hosted job needs it

Local responsibilities:

- Junction-backed reconcile of Garmin summaries, timeseries, sleep, activity, and other configured resources
- local imports into the vault

## Local-only daemon contract

`device-syncd` still requires its own local daemon env contract:

- `DEVICE_SYNC_SECRET` is the daemon's local bootstrap and service secret
- `DEVICE_SYNC_CONTROL_TOKEN` is the daemon's loopback control-plane bearer token

Those are local-daemon concerns. They are not part of the hosted browser or hosted execution auth contract. Local and tunneled daemon callback URLs remain explicitly configured on the daemon boundary and are not subject to the hosted browser app-session hostname check.

Hosted execution continues to use signed internal web callbacks and hosted agent/session credentials instead of the daemon's `DEVICE_SYNC_CONTROL_TOKEN`.

## Fitbit migration continuation

The browser owns presentation and explicit Google authorization only. Its persisted Google source `firstSeenAt` is also the authorization epoch used by both exact Google and Fitbit proof jobs. That existing epoch participates in their current job identity; stale queued, leased, retry, timeseries, or workout lineages cannot certify a later authorization. The wake-local hosted device-sync pass drains scheduled and webhook work, publishes source state, and then asks Web to attempt cutover. Web re-enters the existing connection mutation lock, rejects pending dirty state, evaluates importer-owned canonical evidence, and calls targeted provider revoke outside the transaction. A crash is recovered by probing that exact Fitbit provider source; only provider-confirmed inactivity is finalized locally. No migration table, queue, or second state owner exists.

Deploy importer, Device Sync, and hosted-runtime consumers before the Web bundle so every cutover caller understands source-scoped evidence, per-resource fences, retry identity, and Google Health admission. Then deploy Web and smoke one explicit Google authorization. Temporary version skew leaves legacy Fitbit active rather than cutting over without complete evidence.
