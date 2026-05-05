# Device-Sync Webhook Dirty-State Architecture

## Goal

Stop provider webhook backfills from becoming hosted execution fanout.

The greenfield target is:

```text
per-webhook trace/audit
per-connection dirty state with safe resource/window detail
coalesced user runner wake as a scheduling hint
runtime pulls dirty state as a first-class work source
semantic provider job dedupe by resource/window, not trace
```

Success criteria:

- Every accepted provider webhook still gets exact trace/audit handling.
- Repeated webhook freshness for one hosted device connection updates one dirty
  aggregate instead of appending one mailbox command per trace.
- Webhook trace completion depends on durable audit/dirty acceptance, not on
  Vercel Workflow or Cloudflare nudge delivery.
- Hosted mailbox remains for exact, individually meaningful events. Device-sync
  webhook freshness does not use mailbox.
- Hosted runtime checks dirty device-sync rows on normal invocations and after
  system mailbox work, not only when a device-sync mailbox item exists.
- Dirty revision ack is checkpoint-safe and returns continuation state.
- A device-sync dirty sweeper recovers missed best-effort runner wakes.
- Junction/provider webhook job identity is semantic resource/window identity,
  not provider trace identity.

## Incident Class

The old shape treated webhook arrival as runner execution work:

```text
provider webhook trace
  -> device-sync signal
  -> hosted mailbox item
  -> Vercel nudge workflow
  -> Cloudflare /nudge
  -> Durable Object pending nudge
  -> hosted runtime mailbox import
  -> local system mailbox item
  -> device-sync wake hint
  -> checkpoint/snapshot work
```

This created the wrong dispatch unit. Provider trace dedupe only suppressed
exact retries. Hosted mailbox dedupe used trace-specific wake IDs. Cloudflare
Durable Objects coalesced nudges only after each workflow had already reached
Cloudflare. A historical provider backfill with thousands of distinct trace IDs
therefore produced thousands of control-plane commands before any downstream
budget could help.

The correct semantic unit for webhook freshness is:

```text
hosted user + device-sync connection has dirty provider data to reconcile
```

not:

```text
provider trace ID deserves a runner command
```

## Final Architecture

### Webhook Ingress

Accepted webhook handling is:

```text
claim exact provider trace
transaction:
  write sparse DeviceSyncSignal audit row
  upsert device_sync_dirty_connection
  complete provider webhook trace
commit
if clean -> dirty transition:
  best-effort nudge the hosted runner user
```

The webhook path does not append a hosted mailbox item and does not start a
Vercel Workflow. If the post-commit nudge fails, the provider trace remains
completed because durable work acceptance already committed. Recovery is
internal through dirty sweeper and later runner invocations.

### Dirty State

`device_sync_dirty_connection` is keyed by hosted connection ID. It stores:

- `connection_id`, `user_id`, `provider`
- `dirty_revision`, incremented on every accepted webhook
- `processed_revision`, advanced only after checkpoint-safe runtime handoff
- `first_dirty_at`, `latest_dirty_at`
- widened `window_start`, `window_end`
- `event_count`
- latest safe trace/event/resource metadata
- compact source-provider and resource-category counters
- `dirty_resources_json`, a bounded safe map used to build semantic local jobs

The dirty resource map stores only compact execution metadata:

```json
{
  "garmin:timeseries:steps": {
    "sourceProviderSlug": "garmin",
    "resourceCategory": "timeseries",
    "resource": "steps",
    "windowStart": "2026-05-01T00:00:00.000Z",
    "windowEnd": "2026-05-02T00:00:00.000Z",
    "count": 4
  }
}
```

It must not store raw provider webhook bodies, provider tokens, nested provider
profiles, contact identifiers, raw health samples, or user-visible health
facts.

### Runner Wake

Webhook ingress uses `nudgeHostedRunnerUserBestEffortResult` only as a
coalesced user-level scheduling hint. The nudge contains no work details. It
only tells Cloudflare that the user may have pending durable work.

The durable source of truth is the dirty table. If a nudge is missed, the dirty
row remains pending and the dirty sweeper can nudge the same user later.

### Runtime Pull

The hosted runner loop treats dirty device-sync state as a first-class source:

```text
runner invocation:
  import exact mailbox work
  drain pending device-sync dirty rows
  run bounded assistant/provider maintenance
  checkpoint
  ack dirty revision after checkpoint if local jobs were durably handed off
  schedule continuation if dirty remains or local jobs remain
```

The runtime device-sync port now supports:

```ts
fetchDirtyStates({ limit }): Promise<{
  items: HostedDeviceSyncDirtyState[];
  hasMore: boolean;
  nextWakeAt: string | null;
}>

ackDirtyStateProcessed({
  connectionId,
  processedRevision,
}): Promise<{
  recorded: boolean;
  dirtyRevision: string | null;
  processedRevision: string | null;
  stillDirty: boolean;
  nextWakeAt: string | null;
}>
```

Ack means the dirty revision was converted into local runtime device-sync jobs
and survived the hosted workspace checkpoint boundary. It does not mean provider
fetches have all succeeded. The local device-sync scheduler owns job retries and
provider failures after handoff.

If a webhook arrives while the runner is processing revision `R`, the ack
advances `processed_revision = R` and returns `stillDirty: true` plus
`nextWakeAt` when `dirty_revision > R`. That makes the continuation explicit
instead of relying on an external cron to discover the race.

### Mailbox Boundary

Mailbox remains for exact events:

- conversation messages
- Linq/Telegram/email messages
- assistant notifications
- member lifecycle/system events
- explicit non-webhook device-sync lifecycle commands such as connection
  established and disconnect

Mailbox is not used for high-cardinality device-sync webhook freshness. That
prevents provider backfills from creating one system mailbox item, one workflow,
and one Cloudflare call per trace.

### Sweeper

The device-sync dirty sweeper is device-specific recovery:

```text
find users with rows where dirty_revision > processed_revision
and latest_dirty_at is older than the stale threshold
limit bounded users per run
best-effort nudge each user runner
```

It complements the mailbox lag sweeper. The mailbox lag sweeper recovers exact
mailbox event delivery. The dirty sweeper recovers coalesced freshness state.

### Job Dedupe

Provider webhook jobs must dedupe by semantic work identity:

```text
junction:connection-backfill:<connectionId>:<windowStart>:<windowEnd>
junction:connection-reconcile:<connectionId>:<windowStart>:<windowEnd>
junction:resource:<connectionId>:<sourceProviderSlug>:<resourceCategory>:<resource>:<windowStart>:<windowEnd>
```

Provider trace IDs stay in audit rows and signals. They are not part of local
device-sync job dedupe identity.

## Migration Notes

This is greenfield enough to avoid a transitional generic wake broker or
device-sync mailbox adapter. Existing hosted user connection/token/audit data is
preserved. The change adds the dirty aggregate and runtime callback routes while
cutting new webhook freshness away from mailbox/workflow dispatch.

Existing connection-established and disconnect paths still emit immediate
device-sync lifecycle wakes because those are explicit lifecycle commands, not
high-cardinality freshness hints.

## Required Tests

Focused regression coverage should prove:

- a normal webhook writes signal, upserts dirty state, completes trace, and
  direct-nudges only on dirty transition
- 2,500 distinct webhook traces for the same connection create 2,500 audit
  writes but only one direct dirty-transition nudge while dirty
- same-minute clean-to-dirty transitions request progress again because
  revisions, not wall-clock buckets, define progress
- dirty resource shaping preserves safe source/resource/window metadata and
  drops unsafe payload fields
- dirty pending runtime fetch converts dirty rows into semantic local jobs
- dirty ack returns `stillDirty` and `nextWakeAt`
- device-sync `nextWakeAt` propagates through runtime/system-mailbox checkpoint
  scheduling
- dirty sweeper nudges stale dirty users with redacted logs
- Cloudflare web-control allowlists include the dirty pending/ack callbacks
- Junction job dedupe no longer includes provider trace IDs

## Completion State

Implementation is complete in the current checkout and verified with focused
tests/typechecks for the web control plane, assistant runtime, Cloudflare
runtime bridge, and Junction provider. No commit has been created because the
user paused committing and the working tree contains unrelated active edits.
Status: completed
Updated: 2026-05-05
Completed: 2026-05-05
