# Hosted Runtime Greenfield Hard Cut Migration Guide

Date: 2026-04-26
Status: planning guide
Cut type: destructive hard cut, no compatibility layer

## Verdict

The hosted runtime should stop being a web-orchestrated run protocol. The long-term shape should be:

```text
apps/web = hosted product control plane + encrypted mailbox + latest checkpoint pointer + redacted status/logs
apps/cloudflare = per-user lease/alarm/container runner
packages/assistant-runtime + packages/assistant-engine = the execution state machine
```

The target is not a better `HostedRun`. The target is no executor-facing `HostedRun`.

Cloudflare should feel like a simple remote container that runs the same local runtime with hosted ports. Web should durably accept input and store checkpoints, but it should not decide which messages were executed, which assistant turn is current, which outbox effects are safe, or whether a same-conversation late message should revise the draft.

## Smallest Stable Shape

Keep only these hosted primitives:

```text
HostedMailboxItem          append-only encrypted input
HostedMailboxPayload       optional encrypted large payload body
HostedMailboxLaneCounter   per-user per-lane sequence allocator
HostedWorkspace            latest encrypted checkpoint pointer plus redacted status projection
HostedRuntimeLog           bounded redacted observability events
Durable Object lease       single-user runner coordination
```

Everything else should be local runtime behavior restored inside the hosted workspace.

Avoid adding primitives that answer these questions outside the runtime:

- Has this message been processed?
- Which assistant turn owns this message?
- Is this outbox effect safe to send?
- Which pending input should revise this reply?
- Which internal timer is due?

Those answers live in the encrypted workspace checkpoint, not in web or Durable Object state.

## Success Criteria

- A hosted user message is appended to a durable encrypted mailbox before any runner is required.
- The runner imports mailbox items into local runtime state and checkpoints immediately after import.
- If the runner times out after import but before reply, the imported message is still present on the next run.
- If another same-conversation message arrives while the assistant is calling tools or the model, the runtime refreshes the hosted mailbox before delivery, imports the new message, checkpoints, and uses the existing local turn-revision loop to rerun the reply.
- Web does not own run adoption, assistant cursors, turn revision, side-effect finalization, or per-event completed/running state.
- Cloudflare Durable Object state contains only runner coordination, not queue history or execution recovery truth.
- Logging/debuggability is preserved through redacted structured runtime logs and status projections.
- The old run-centric protocol is deleted, not shimmed.

## Non-Goals

- No staged compatibility with existing `HostedRun` rows.
- No web-owned executor queue.
- No web-owned turn-input peek/adopt.
- No Cloudflare-owned durable queue.
- No generic runtime CRUD surface in Cloudflare.
- No plaintext payloads, transcripts, provider secrets, local filesystem paths, or direct personal identifiers in hosted logs or docs.
- No migration of existing hosted users. This guide assumes no users and allows table replacement and bucket cleanup.

## Current Baseline To Replace

The current hosted path has these correctness owners:

- `apps/web/prisma/schema.prisma`
  - `HostedExecutionCursor`
  - `HostedIngressEvent`
  - `HostedRun`
  - `HostedRunLog`
  - `HostedIngressEventAlias`
  - `HostedIngressPayload`
- `apps/web/src/lib/hosted-run/**`
  - acquire
  - commit
  - finalize
  - release-finalize
  - run log/status
  - turn-input peek/adopt
- `apps/web/app/api/internal/hosted-run/**`
  - executor-facing web APIs for the run protocol
- `apps/cloudflare/src/user-runner.ts`
  - `drainHostedRuns`
  - `nudgeHostedRun`
  - drain lock
  - acquire loop
  - committed seq hints
- `apps/cloudflare/src/user-runner/run-finalization.ts`
  - prepare/commit/finalize around web-owned runs
- `apps/cloudflare/src/user-runner/runner-run-processor.ts`
  - prepared/finalized result phases
  - run phases
  - finalize recovery
  - run breadcrumbs
- `apps/cloudflare/src/runner-outbound/turn-input.ts`
  - hosted turn-input peek/adopt
- `apps/cloudflare/src/web-control-plane.ts`
  - hosted-run acquire/commit/finalize/log/status/peek/adopt clients
- `packages/hosted-execution/src/contracts.ts`
  - run, cursor, run-drain, event-result, cleanup-target contracts
- `packages/hosted-execution/src/parsers/run-control.ts`
  - run-control parsers
- `packages/cloudflare-hosted-control/src/**`
  - web-to-Cloudflare `run` route names
  - `nudgeUserRun`
  - run-shaped status/client naming
- `packages/assistant-runtime/src/hosted-runtime/execution.ts`
  - `executeHostedRunDrainForCommit`
  - `completeHostedRunDrainAfterCommit`
  - adopted event results
  - adopted cleanup targets
- `packages/assistant-runtime/src/hosted-runtime/turn-input.ts`
  - runtime wrapper around web-owned hosted turn-input adoption
- `packages/assistant-runtime/src/hosted-runtime/platform.ts`
  - turn-input port
  - hosted side-effect journal/finalization callbacks
- `packages/assistant-runtime/src/hosted-runtime/callbacks.ts`
  - committed side-effect phase that mirrors local outbox into a hosted finalize protocol
- Hosted vault-sync code paths
  - queued ingress event references
  - run-summary commit helpers
- Cloudflare outbound/bootstrap code paths
  - `runtime_bootstrapped`
  - `bootstrapUser`
  - key-store resolution coupled to runner bootstrap state

The hard cut replaces that with mailbox import plus runtime checkpoints.

## Target Ownership

### `apps/web` Owns

- Hosted member identity, routing, billing, auth, onboarding, email authorization, device-sync authority, share metadata, vault-sync sessions, usage ledger, and other product/control-plane facts.
- Encrypted external mailbox rows.
- Encrypted raw payload storage when payloads are too large for inline mailbox ciphertext.
- Latest encrypted hosted workspace checkpoint pointer.
- Redacted runtime status projection.
- Redacted runtime logs.
- Narrow signed callbacks for side inputs the runtime needs from web-owned authority, such as share payload fetch, vault-sync payload fetch, device-sync snapshot/apply, usage record export, and issue export.

### `apps/web` Does Not Own

- Assistant execution cursor.
- Message-processing completion state.
- Same-conversation turn revision.
- Outbox truth.
- Provider delivery retry policy.
- Internal runtime timers.
- Runtime follow-up queues.
- Run acquire/commit/finalize recovery.

### `apps/cloudflare` Owns

- Per-user Durable Object routing.
- Lease/fencing generation.
- Alarm/nudge coalescing.
- Container invocation.
- Encrypted bundle/artifact object storage plumbing.
- Runtime bridge transport for the isolated child.
- Worker-owned callback signing to web.
- Redacted logs/status forwarding.

### `apps/cloudflare` Does Not Own

- Product facts.
- Mailbox state.
- Mailbox import watermarks.
- Assistant cursors.
- Outbox truth.
- Web-visible execution runs.
- Durable queue history.

### Runtime Owns

- Mailbox import into local inbox/capture state.
- Assistant sessions, transcripts, receipts, diagnostics, automation cursors, status snapshots, and outbox intents under `.runtime/operations/assistant/**`.
- Inbox/parser/device-sync/share/vault-sync execution semantics.
- Same-conversation late-input revision.
- Outbox dispatch and receipt/reconciliation policy.
- Runtime timers and next wake projection.
- Checkpoint timing.

## Target Data Model

Use destructive Prisma migrations. Do not preserve the old run tables.

### Replace `HostedIngressEvent` With `HostedMailboxItem`

Suggested model:

```prisma
model HostedMailboxItem {
  id                      String       @id
  userId                  String       @map("user_id")
  lane                    String
  laneSeq                 BigInt       @map("lane_seq")
  dedupeKey               String       @map("dedupe_key")
  kind                    String
  occurredAt              DateTime     @map("occurred_at")
  payloadSchema           String       @map("payload_schema")
  payloadInlineCiphertext String?      @map("payload_inline_ciphertext")
  payloadRef              String?      @map("payload_ref")
  payloadBytes            Int?         @map("payload_bytes")
  expiresAt               DateTime?    @map("expires_at")
  createdAt               DateTime     @default(now()) @map("created_at")
  updatedAt               DateTime     @updatedAt @map("updated_at")
  member                  HostedMember @relation(fields: [userId], references: [id], onDelete: Cascade)
  payload                 HostedMailboxPayload?

  @@unique([userId, lane, laneSeq])
  @@unique([userId, dedupeKey])
  @@index([userId, lane, laneSeq])
  @@index([userId, kind, createdAt])
  @@index([userId, expiresAt])
  @@map("hosted_mailbox_item")
}
```

### Add `HostedMailboxLaneCounter`

Deleting `HostedExecutionCursor` removes the current sequence allocator. Replace only that allocator role with a small per-lane counter. It is not an execution cursor.

Suggested model:

```prisma
model HostedMailboxLaneCounter {
  userId    String       @map("user_id")
  lane      String
  nextSeq   BigInt       @default(1) @map("next_seq")
  updatedAt DateTime     @updatedAt @map("updated_at")
  member    HostedMember @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@id([userId, lane])
  @@map("hosted_mailbox_lane_counter")
}
```

Rules:

- Increment the counter in the same database transaction that inserts the mailbox item.
- Keep one idempotency identity: `dedupeKey`.
- Duplicate `dedupeKey` is first-wins.
- If the same `dedupeKey` is retried with a different payload hash or kind, return the existing item, emit a redacted conflict log, and never rewrite the original row.
- Do not add aliases, replacements, or coalescing rows in web.

### Replace `HostedIngressPayload` With `HostedMailboxPayload`

Suggested model:

```prisma
model HostedMailboxPayload {
  mailboxItemId    String       @id @map("mailbox_item_id")
  userId           String       @map("user_id")
  payloadCiphertext String      @map("payload_ciphertext")
  payloadSchema    String       @map("payload_schema")
  createdAt        DateTime     @default(now()) @map("created_at")
  member           HostedMember @relation(fields: [userId], references: [id], onDelete: Cascade)
  mailboxItem      HostedMailboxItem @relation(fields: [mailboxItemId], references: [id], onDelete: Cascade)

  @@index([userId, createdAt])
  @@map("hosted_mailbox_payload")
}
```

### Replace `HostedExecutionCursor` With `HostedWorkspace`

Suggested model:

```prisma
model HostedWorkspace {
  userId                  String       @id @map("user_id")
  version                 BigInt       @default(0)
  snapshotRef             Json?        @map("snapshot_ref")
  browserVaultReplicaRef  Json?        @map("browser_vault_replica_ref")
  nextWakeAt              DateTime?    @map("next_wake_at")
  nextWakeReason          String?      @map("next_wake_reason")
  redactedStatusJson      Json?        @map("redacted_status_json")
  checkpointedAt          DateTime?    @map("checkpointed_at")
  createdAt               DateTime     @default(now()) @map("created_at")
  updatedAt               DateTime     @updatedAt @map("updated_at")
  member                  HostedMember @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("hosted_workspace")
}
```

Notes:

- `version` is the workspace CAS fence.
- `snapshotRef` is an encrypted hosted bundle ref.
- `redactedStatusJson` may include mailbox imported-through projections for status and GC hints, but runtime mailbox import state remains inside the encrypted checkpoint.
- `nextWakeAt` is a projection from runtime state, not a web-owned timer event.
- `browserVaultReplicaRef` is a dashboard projection pointer. It is not runtime correctness state and must not be used to decide mailbox import or assistant execution.

### Replace `HostedRunLog` With `HostedRuntimeLog`

Suggested model:

```prisma
model HostedRuntimeLog {
  id                 String       @id
  userId             String       @map("user_id")
  at                 DateTime
  level              String
  component          String
  phase              String
  eventCode          String       @map("event_code")
  attemptId          String?      @map("attempt_id")
  leaseGeneration    BigInt?      @map("lease_generation")
  workspaceVersion   BigInt?      @map("workspace_version")
  checkpointVersion  BigInt?      @map("checkpoint_version")
  mailboxLane        String?      @map("mailbox_lane")
  mailboxSeqStart    BigInt?      @map("mailbox_seq_start")
  mailboxSeqEnd      BigInt?      @map("mailbox_seq_end")
  outboxIntentRef    String?      @map("outbox_intent_ref")
  errorCode          String?      @map("error_code")
  redactedJson       Json?        @map("redacted_json")
  createdAt          DateTime     @default(now()) @map("created_at")
  member             HostedMember @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, at])
  @@index([level, at])
  @@index([component, at])
  @@map("hosted_runtime_log")
}
```

Logs are best-effort observability. Checkpoints and local runtime state are correctness.

Log constraints:

- `eventCode` comes from a small allowlisted enum, for example `mailbox.imported`, `mailbox.retryable_payload_missing`, `checkpoint.cas_conflict`, `outbox.ambiguous`, or `runner.lease_superseded`.
- `component` and `phase` also come from allowlists.
- `redactedJson` uses allowlisted keys only.
- `attemptId`, checkpoint reason, mailbox seqs, and `outboxIntentRef` are correlation fields only. They must never drive retry, delivery, import, or cleanup correctness.
- Do not store free-form runtime messages in web. Free-form logs have a habit of becoming protocol state and privacy risk.

## Mailbox Lanes

Use lanes to avoid reintroducing one global executor queue.

Initial lanes:

```text
conversation
system
```

Rules:

- `conversation` includes `conversation.message`.
- `system` includes activation, channel updates, assistant notification requests, device-sync wakes, share acceptance, and vault-sync imports.
- Each lane has its own strict `laneSeq`.
- Web assigns lane seqs atomically at append time.
- Runtime imports strict prefixes per lane.
- A temporary missing payload stops that lane only.
- A malformed permanent item is quarantined in runtime import state, logged, and the lane advances.
- Web does not mark mailbox rows running, completed, or quarantined.
- Do not add a global execution sequence to solve cross-lane dependencies.

Two lanes are enough for the hard cut. If a system input must precede conversation handling, make the runtime importer enforce a product readiness gate, such as "activation imported before conversation import" or "channel route exists before delivery." Do not turn web back into a global executor queue.

Do not keep web coalescing as a mailbox mutation in the first cut. Append all inputs and let the runtime importer collapse stale configuration or channel-update inputs if needed. If coalescing becomes necessary later, implement it as a runtime import reducer, not as row replacement plus aliases in web.

## Runtime Mailbox Import State

Add one portable operational state file inside the hosted workspace snapshot:

```text
vault/.runtime/operations/assistant/hosted-mailbox.json
```

Suggested schema:

```json
{
  "schema": "murph.hosted-mailbox-import.v1",
  "schemaVersion": 1,
  "lanes": {
    "conversation": {
      "importedSeq": "0",
      "lastImportedAt": null,
      "quarantined": []
    },
    "system": {
      "importedSeq": "0",
      "lastImportedAt": null,
      "quarantined": []
    }
  },
  "lastRefreshAt": null
}
```

Rules:

- Use `packages/runtime-state` versioned JSON helpers.
- `importedSeq` advances only after durable local import has completed.
- Runtime checkpoints after any import progress.
- Quarantine entries contain only mailbox item id, lane, lane seq, kind, sanitized error code, and timestamp.
- No plaintext message bodies or provider payloads in this state file.
- Do not store imported mailbox item mirrors, debug history, or per-item completion state.
- Do not reuse inbox `source_cursor`; that is connector/projection state, not hosted mailbox import truth.

## Runtime Platform Contract

Replace run-shaped platform ports with mailbox/checkpoint-shaped ports.

Suggested shape:

```ts
interface HostedRuntimePlatform {
  artifactStore: HostedRuntimeArtifactStore;
  mailboxPort: {
    fetch(input: {
      lanes: readonly HostedMailboxLaneCounter[];
      limitPerLane: number;
      requestId: string;
    }): Promise<HostedMailboxFetchResult>;
  };
  workspacePort: {
    checkpoint(input: HostedWorkspaceCheckpointRequest): Promise<HostedWorkspaceCheckpointResult>;
  };
  logPort: {
    write(entries: readonly HostedRuntimeLogEntry[]): Promise<void>;
  };
  effectsPort: HostedRuntimeEffectsPort;
  deviceSyncPort?: HostedRuntimeDeviceSyncPort | null;
  sharePort?: HostedRuntimeSharePort | null;
  vaultSyncPort?: HostedRuntimeVaultSyncPort | null;
  rawPayloadPort?: HostedRuntimeRawPayloadPort | null;
  usageExportPort?: HostedRuntimeUsageExportPort | null;
  issueExportPort?: HostedRuntimeIssueExportPort | null;
  billingPort?: HostedRuntimeBillingPort | null;
}
```

The child runtime should not know web routes. It should call semantic ports.

`workspacePort.checkpoint` is a semantic runtime operation, not a bundle API. The runtime asks for a checkpoint with a reason, status projection, and next wake hint. The hosted adapter snapshots the current workspace, writes encrypted objects, performs web CAS, and returns the new workspace version. The runtime should not pass or reason about `snapshotRef`.

Side-input ports are also semantic. Share payloads, vault-sync import payloads, raw email/message payloads, device-sync snapshots, usage export, and issue export should be named by product meaning, not by hosted-run dispatch payloads or Cloudflare storage internals.

If the child must talk over HTTP because it runs in an isolated process, collapse the current multi-host internal proxy into one worker-owned runtime bridge:

```text
POST /__internal/runtime-bridge/mailbox/fetch
POST /__internal/runtime-bridge/workspace/checkpoint
POST /__internal/runtime-bridge/logs/write
GET  /__internal/runtime-bridge/payloads/email/:key
GET  /__internal/runtime-bridge/share/:payloadId
GET  /__internal/runtime-bridge/vault-sync/:payloadId
POST /__internal/runtime-bridge/effects/email/send
POST /__internal/runtime-bridge/device-sync/*
POST /__internal/runtime-bridge/usage/record
POST /__internal/runtime-bridge/issues/record
```

Keep one short-lived bridge token scoped to user id, lease generation, and attempt id. Do not keep per-run tokens because there are no runs.

The isolated child must not receive web signing credentials, web route names, or the full supervisor env. Production authority should be:

```text
child runtime -> bridge token -> Cloudflare parent/UserRunner lease -> signed web callback
```

If local development keeps a fallback direct path, it must not become production default and must be deleted or hard-disabled before deploy.

## Cloudflare Durable Object Target

Replace `runner_meta` with coordination-only state:

```sql
CREATE TABLE IF NOT EXISTS runner_meta (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  user_id TEXT NOT NULL,
  lease_generation INTEGER NOT NULL DEFAULT 0,
  lease_expires_at TEXT,
  in_flight INTEGER NOT NULL DEFAULT 0,
  heartbeat_at TEXT,
  last_error_at TEXT,
  last_error_code TEXT,
  last_invocation_at TEXT,
  next_alarm_at TEXT,
  pending_nudge INTEGER NOT NULL DEFAULT 0
);
```

`next_alarm_at` is only a local alarm cache. The authoritative next wake projection is `HostedWorkspace.nextWakeAt` in web, because it comes from the latest checkpoint.

Delete:

- `active_run_event_id`
- `active_run_id`
- `active_run_attempt`
- `active_run_started_at`
- `runtime_bootstrapped`, after key-store/bootstrap resolution no longer depends on `bootstrapUser`.
- `last_event_id`
- committed checkpoint/snapshot pointers

`runtime_bootstrapped` is not a harmless flag today. Unwind the outbound crypto/bootstrap coupling first: key-store resolution should read the encrypted runner secret/key material directly through the runner's narrow authority, not mark bootstrap completion as a side effect of resolving outbound payload helpers.

Durable Object methods should become:

```text
nudge()
runUntilIdleOrBudget({ reason })
status()
alarm()
```

Delete:

```text
nudgeHostedRun()
drainHostedRuns()
drainHostedRunsInternal()
targetCommittedSeqHint
committedSeq result payloads
```

## Cloudflare Runner Algorithm

Target `runUntilIdleOrBudget`:

```text
1. Read runner state.
2. If another invocation is in flight, set/sync alarm for now and return accepted.
3. Begin a new lease generation and mark in_flight = 1.
4. Fetch latest HostedWorkspace from web.
5. If no workspace row or snapshot exists, enter the bootstrap/null-snapshot path.
6. Otherwise restore hosted execution context from the encrypted snapshot ref.
7. Build hosted runtime platform ports.
8. Run hosted runtime until idle or budget.
9. Runtime checkpoints through workspacePort as it progresses.
10. Record heartbeat/error/alarm projection only.
11. Clear in_flight.
12. Fetch latest web workspace status and schedule one DO alarm for nextWakeAt if present.
```

Important fencing:

- Every checkpoint includes expected workspace version and lease generation.
- Web accepts a checkpoint only if the expected workspace version matches.
- Cloudflare/UserRunner validates the bridge token and current lease generation before object upload and again before web checkpoint.
- A stale runner that wakes late may log, but it cannot advance the workspace.
- On CAS conflict, stop the runner and schedule a retry from the latest checkpoint. Do not merge snapshots.
- If the child made progress before a CAS conflict, that progress is discarded with the orphaned bundle. Correctness comes from rerunning from the latest accepted checkpoint.

Do not make web a lease owner. Web owns workspace CAS; Cloudflare/UserRunner owns lease fencing.

## Bootstrap And Empty Workspace

Do not special-case activation as a run. Bootstrap is the first workspace checkpoint.

Target flow:

```text
1. Web creates or upserts HostedWorkspace with version 0 and null snapshotRef.
2. Web appends `member.activated` to the system mailbox in the same product transaction.
3. Web nudges Cloudflare best effort.
4. Cloudflare starts `runUntilIdleOrBudget`.
5. Runtime restores an empty workspace from the hosted launch spec.
6. Runtime imports `member.activated`.
7. Runtime writes the initial vault/operator config/runtime state.
8. Runtime checkpoints version 0 -> 1.
9. Later mailbox items run through the same import path.
```

The only bootstrap-specific code should be local workspace creation when `snapshotRef` is null. Do not add a bootstrap run table, a bootstrap completion event, or a separate activation cursor.

## Hosted Runtime Algorithm

Add a new entrypoint:

```text
runHostedWorkspaceUntilIdleOrBudget(input)
```

The entrypoint should:

```text
1. Restore local workspace from the provided snapshot, or create an empty hosted workspace if snapshotRef is null.
2. Refresh hosted mailbox for system and conversation lanes.
3. Import strict prefixes into the same local inbox/runtime paths used by local execution.
4. Enforce runtime readiness gates during import, such as activation before conversation delivery.
5. Checkpoint immediately if any import progressed.
6. Run due local runtime work:
   - activation/bootstrap
   - channel reconciliation
   - conversation auto-reply
   - notification requests
   - device-sync work
   - share imports
   - vault-sync imports
   - outbox retry/reconciliation
7. Before delivery, refresh hosted mailbox again.
8. If new same-conversation captures arrived, checkpoint and throw/use `AssistantTurnRevisionRequiredError`.
9. Let the existing bounded local revision loop rerun the reply.
10. Before external side effects, checkpoint the outbox intent and `sending` state.
11. After external side effects, checkpoint receipt, retry, or ambiguous state.
12. Export redacted status/logs and nextWakeAt.
13. Stop when idle or budget exhausted.
```

Delete or replace:

```text
executeHostedRunDrainForCommit
completeHostedRunDrainAfterCommit
HostedRuntimeDrainRequest
HostedRuntimeDrainEvent as executor-facing job shape
adoptedEventResults
adoptedCleanupTargets
runDrain metrics as correctness output
```

Event-specific handlers can remain if they become importer handlers:

```text
events/conversation.ts
events/email.ts
events/linq.ts
events/telegram.ts
events/share.ts
events/vault-sync.ts
hosted-device-sync-runtime.ts
```

But they should no longer return run event results to web.

## Before-Delivery Turn-Input Revision

This is a day-one requirement.

Current local primitives already support it:

- `createAssistantTurnBeforeDeliveryHook` refreshes input before delivery.
- `AssistantTurnRevisionRequiredError` carries newly arrived same-conversation captures.
- The automation reply loop catches that error and reruns the reply within a bounded revision budget.

Hosted should use those primitives directly, but this is not automatic in the current hosted path. The hosted automation path must inject the mailbox-backed turn-input port on day one; otherwise deleting web peek/adopt removes the only current hosted late-input refresh. Do not rely on the default inbox-backed port being created for hosted execution.

Target hosted refresh:

```text
1. The local assistant is about to deliver a draft.
2. The hosted before-delivery hook asks the mailbox importer to fetch the conversation lane after the runtime import watermark.
3. Runtime imports new conversation mailbox items into local inbox/capture state.
4. Runtime updates `hosted-mailbox.json`.
5. Runtime checkpoints immediately.
6. Local `listNewConversationCaptures` detects captures for the same conversation.
7. It throws `AssistantTurnRevisionRequiredError`.
8. The existing local revision loop reruns the reply with the expanded capture group.
```

This replaces:

```text
web turn-input peek
web turn-input adopt
marking later rows running
adding events to the active run
returning adopted event results
cleanup targets for adopted events
```

The mailbox fetch is read-only from web's perspective. Import/adoption is a runtime checkpoint.

## Side Effects And Outbox

Do not preserve hosted run finalization as a side-effect protocol.

Target rule:

```text
Before any external mutation, the runtime has durably checkpointed the intent.
After the mutation, the runtime checkpoints the receipt or ambiguity state.
```

Use the local assistant outbox as the source of truth:

```text
pending -> sending -> sent
pending -> sending -> failed
pending -> sending -> delivery confirmation pending / retry / abandoned
```

Use the existing outbox vocabulary in implementation. Ambiguous post-send outcomes should flow through the current receipt/confirmation/retry/reconcile concepts rather than adding a new hosted-only ambiguous status.

Policy:

```text
read-only tool:
  retry freely

model generation:
  retry freely unless a delivery intent was already committed

message delivery / external mutation:
  retry only by stable outbox idempotency key

non-idempotent or ambiguous delivery:
  reconcile provider state or ask for confirmation before resend
```

Migration steps:

1. Keep `deliveryDispatchMode: "queue-only"` for hosted assistant automation until the runtime enters the explicit outbox drain phase.
2. Ensure outbox intent creation is checkpointed before dispatch.
3. Move hosted email/Linq/Telegram provider adapters into runtime `effectsPort` dependencies for `dispatchAssistantOutboxIntent`.
4. Checkpoint when an intent enters `sending`.
5. Checkpoint when an intent reaches `sent`, `failed`, confirmation-pending, retry, reconcile, or abandoned state according to the existing local outbox model.
6. Delete committed assistant delivery effects from the hosted run result path.
7. Reduce `packages/hosted-execution/src/side-effects.ts` to shared codecs only if a provider adapter still needs them. Otherwise delete it.

Current local tests around outbox retry, stale sending reconciliation, ambiguous errors, and receipts should become the correctness baseline for hosted too.

## Checkpoint Semantics

A checkpoint is the only hosted commit.

Checkpoint input:

```ts
interface HostedWorkspaceCheckpointRequest {
  attemptId: string;
  expectedWorkspaceVersion: string;
  leaseGeneration: string;
  nextWakeAt?: string | null;
  nextWakeReason?: string | null;
  redactedStatus?: Record<string, unknown> | null;
  browserVaultProjection?: HostedBrowserVaultProjectionUpdate | null;
  reason:
    | "import"
    | "before_delivery_refresh"
    | "outbox_intent"
    | "outbox_receipt"
    | "maintenance"
    | "idle"
    | "budget_exhausted"
    | "error";
}
```

Checkpoint process:

```text
1. Runtime calls `workspacePort.checkpoint` with reason, expected workspace version, next wake, and redacted status.
2. Hosted adapter snapshots the current local workspace to a bundle.
3. Cloudflare writes bundle/artifacts to R2 using current encryption/keyring.
4. Hosted adapter calls web checkpoint with expected workspace version plus the new encrypted snapshot ref.
5. Web CAS updates `HostedWorkspace.version`, `snapshotRef`, `redactedStatusJson`, `nextWakeAt`, and optional browser-vault projection pointer.
6. Web returns the new workspace version.
7. Runtime records the new version for later checkpoints in the same invocation.
```

If bundle upload succeeds but web CAS fails:

- Treat the uploaded bundle as orphaned.
- Do not update DO state to that snapshot.
- Schedule retry from the authoritative web workspace pointer.
- Let bundle GC remove orphaned objects later.

If web CAS succeeds but final DO state update fails:

- Web remains authoritative for checkpoint.
- Later status may be stale, but execution recovery is safe.
- On next nudge/alarm, Cloudflare restores from web workspace.

## Mailbox Append Semantics In Web

Every hosted producer should do this in one transaction with product/control-plane mutation:

```text
1. Validate product/control-plane mutation.
2. Build canonical hosted mailbox envelope.
3. Encrypt payload.
4. Allocate `laneSeq` from `HostedMailboxLaneCounter`.
5. Insert `HostedMailboxItem`.
6. Commit transaction.
7. Best-effort nudge Cloudflare.
```

Producers:

- hosted onboarding activation
- hosted channel updates
- Linq inbound message
- Telegram inbound message
- email inbound message
- assistant notification request
- device-sync wake
- share accepted
- vault-sync import ready

Dedupe:

- Use `(userId, dedupeKey)` uniqueness.
- If duplicate insert is attempted, return the existing item and still nudge best effort.
- If duplicate payload differs, keep first-wins and write only a redacted conflict event.
- Do not replace rows for coalescing in the first cut.

Payload storage:

- Keep inline ciphertext for small payloads.
- Keep payload table/object for large payloads.
- Raw email/message payloads are web-owned encrypted side inputs with TTL/import GC.
- If Cloudflare receives a public email/webhook first, it should act as a transport ingress sidecar that calls web to append the mailbox item. It must not become the runner's correctness store.

## Raw Payload Cleanup

Delete per-run cleanup targets.

First-cut policy:

1. Do not expire raw payloads before import.
2. Runtime treats a missing payload as retryable unless web explicitly returns a permanent gone/quarantine code.
3. Runtime does not advance the lane for retryable missing payloads.
4. Runtime quarantines and advances only for permanent malformed or permanently unavailable payloads.
5. Web GC may delete raw payloads only after the redacted imported-through projection is past the item and a retention grace has elapsed.

The imported-through projection is only a GC hint. Runtime import state inside the encrypted checkpoint remains authoritative. If the projection is stale, GC waits longer; it never causes runtime to skip import.

## Status And Debugging

Preserve debugability without preserving runs.

Status response should include:

```text
userId
inFlight
leaseGeneration
heartbeatAt
lastInvocationAt
workspaceVersion
snapshotRef summary
nextWakeAt
lastErrorCode
mailbox lag by lane
redacted runtime status
recent redacted log entries
```

Mailbox lag:

```text
conversation max laneSeq in web - conversation importedSeq in workspace status projection
system max laneSeq in web - system importedSeq in workspace status projection
```

Log fields:

```text
attemptId
leaseGeneration
workspaceVersion
checkpointVersion
component
phase
eventCode
mailbox lane/seq range
outboxIntentRef
errorCode
redactedJson
```

Never log:

- raw message text
- provider payloads
- provider headers
- authorization headers
- phone numbers
- email addresses
- local filesystem paths
- decrypted vault content
- model prompt bodies unless a separate privacy-reviewed local-only debug lane explicitly allows it

## Path-By-Path Cut Plan

### `packages/hosted-execution`

Keep:

- auth canonicalization
- env normalization
- hosted bundle refs
- hosted email envelope helpers if still used
- observability redaction helpers if still useful
- AI usage billing mode helpers

Replace:

- `HostedIngressEvent` with `HostedMailboxItem`
- `HostedExecutionCursor` sequence allocation with `HostedMailboxLaneCounter`
- `HostedExecutionCursorState` with `HostedWorkspaceState`
- `HostedRunNudgeResult` with `HostedRunnerNudgeResult`
- run route builders with mailbox/workspace/log/status route builders

Delete:

- `HostedRunRecord`
- `HostedRunAcquireRequest/Response`
- `HostedRunCommitRequest/Response`
- `HostedRunFinalizeRequest/Response`
- `HostedRunReleaseFinalizeRequest/Response`
- `HostedRunTurnInputPeekRequest/Response`
- `HostedRunTurnInputAdoptRequest/Response`
- `HostedRuntimeDrainRequest` as the executor-facing job shape
- `HostedRunEventResult`
- `HostedRunCleanupTarget`
- `HOSTED_RUN_STATUSES`
- `HOSTED_RUN_TRIGGER_KINDS` unless a smaller log-only reason enum is needed
- `parsers/run-control.ts`

### `packages/cloudflare-hosted-control`

Keep:

- OIDC-authenticated web-to-Cloudflare client boundary.
- Typed route builders and response parsing.

Replace:

- `run` route naming with `nudge`, `wake`, or `work` naming.
- `nudgeUserRun` with `nudgeUserRunner`.
- run-shaped result payloads with accepted/already-running/status summaries.

Delete:

- any `runId`, committed seq, target seq, or drain-result fields from the web-to-Cloudflare client contract.

### `apps/web`

Keep:

- hosted product/control-plane facts
- hosted ingress producers
- encryption helpers
- payload storage helpers
- Cloudflare auth/signing
- usage, issue, share, vault-sync, billing, device-sync callback routes

Replace:

- `src/lib/hosted-ingress/**` with `src/lib/hosted-mailbox/**`
- `src/lib/hosted-run/status.ts` with hosted workspace/status/log readers
- `src/lib/hosted-execution/control.ts` wake client names from run language to runner/mailbox language
- vault-sync run-summary completion helpers with runtime/product status that does not depend on run commit/finalize.

Delete:

- `src/lib/hosted-run/**`
- `app/api/internal/hosted-run/acquire/route.ts`
- `app/api/internal/hosted-run/commit/route.ts`
- `app/api/internal/hosted-run/finalize/route.ts`
- `app/api/internal/hosted-run/release-finalize/route.ts`
- `app/api/internal/hosted-run/turn-input/peek/route.ts`
- `app/api/internal/hosted-run/turn-input/adopt/route.ts`
- run-owned log/status routes after replacements exist
- `HostedMember` relation fields that point at old cursor/ingress/run/log rows.
- `HostedVaultSyncSession` queued run/ingress coupling such as queued event ids once mailbox append owns readiness.

Rename or move:

- `app/api/internal/hosted-run/email-ingress/route.ts` should move under mailbox or hosted-execution email payload routes if still needed.

New routes:

```text
POST /api/internal/hosted-mailbox/fetch
GET  /api/internal/hosted-workspace
POST /api/internal/hosted-workspace/checkpoint
POST /api/internal/hosted-runtime/log
GET  /api/internal/hosted-runtime/status
```

These are Cloudflare-to-web signed routes. Browser-facing status routes can read the same projections through existing auth.

### `apps/cloudflare`

Keep:

- Vercel OIDC-authenticated control request verification
- user DO routing
- bundle/artifact store
- crypto/keyring handling
- runner secret store
- runner env/launch spec
- container supervisor/child isolation
- hosted email send/read plumbing
- device-sync/share/vault-sync/usage/issue web callbacks
- deployment artifact helpers

Replace:

- `HostedUserRunner.drainHostedRuns` with `runUntilIdleOrBudget`
- `HostedUserRunner.nudgeHostedRun` with `nudge`
- `RunnerRunProcessor` with a new `WorkspaceRunner`; do not adapt the old execute/finalize split.
- `web-control-plane.ts` run clients with workspace/mailbox/log clients
- `runtime-platform.ts` turn-input port with mailbox/checkpoint/log ports
- multi-host internal proxy with one runtime bridge where possible
- direct child web credentials with child-to-bridge-only authority.

Delete:

- `src/user-runner/run-finalization.ts`
- `src/user-runner/wake-inputs.ts`
- run-specific portions of `src/user-runner/runner-run-processor.ts`
- `src/runner-outbound/turn-input.ts`
- run-specific result validation
- committed seq target draining
- run breadcrumbs tied to `runId`
- per-run cleanup targets

Simplify:

- `src/user-runner/runner-state-schema.ts` to lease/alarm/status fields only.
- `src/index.ts` internal route names and response payloads from run semantics to runner semantics.
- `src/runner-container.ts` job input from run-drain request to workspace invocation request.
- local proxy auth so checkpoint-capable bridge calls are validated by the current UserRunner lease, not only by container-token ownership.

### `packages/assistant-runtime`

Keep:

- hosted launch spec and env split
- hosted event-specific import/handling code where useful
- hosted artifact restore/snapshot usage
- hosted device-sync runtime port
- issue/usage export ports
- redacted log utilities
- browser-vault projection export

Replace:

- `executeHostedRunDrainForCommit` with `runHostedWorkspaceUntilIdleOrBudget`
- `completeHostedRunDrainAfterCommit` with ordinary outbox drain/checkpoint stages
- `createHostedAssistantTurnInputPort` with a hosted mailbox importer used by the existing local before-delivery hook
- `HostedRuntimePlatform.turnInputPort` with semantic `mailboxPort`, `workspacePort`, and `logPort`
- hosted side-effect journal methods with ordinary runtime outbox checkpoints.

Delete:

- run-drain request/result models
- adopted event results
- adopted cleanup targets
- committed assistant delivery effects as a hosted run result
- finalization phase handling

### `packages/assistant-engine`

Prefer no broad changes.

Possible targeted hardening:

- Expose or reuse the outbox drain primitive in a way hosted runtime can call directly with hosted provider adapters.
- Ensure `beforeDelivery` runs immediately before the reply becomes externally visible or before the delivery intent is committed.
- Add regression coverage proving a hosted mailbox refresh before delivery reuses the existing local revision loop.

Do not fork assistant semantics for hosted.

## Detailed Migration Phases

### Phase 0: Freeze The Target Contract

1. Write the new ownership decision into durable docs at the start of implementation:
   - `ARCHITECTURE.md`
   - `apps/web/README.md`
   - `apps/cloudflare/README.md`
   - `packages/assistant-runtime/README.md`
   - `packages/hosted-execution/README.md`
   - `packages/cloudflare-hosted-control/README.md` if present, or the package source docs if not.
2. Mark `agent-docs/references/hosted-runtime-protocol.md` obsolete or replace it with a hosted mailbox/checkpoint protocol doc.
3. Add a short glossary:
   - mailbox item
   - mailbox lane
   - workspace checkpoint
   - lease generation
   - runtime import watermark
4. Decide the final route names before touching code:
   - web mailbox fetch
   - web workspace read/checkpoint
   - web runtime log/status
   - Cloudflare runner nudge/status
5. Rename the intended Cloudflare command concept from `run` to `nudge`, `wake`, or `work` before new code spreads.

Acceptance:

- Durable docs no longer describe web-owned run acquire/commit/finalize as the future target.
- The new protocol can be explained without `runId`, `committedSeq`, or `finalizeRequired`.
- `packages/cloudflare-hosted-control` no longer describes `run` as the durable command concept.

### Phase 1: Add Shared Contracts And Runtime Ports

This phase creates the seams but does not yet replace web schema or Cloudflare orchestration.

In `packages/hosted-execution`:

1. Add mailbox item contracts.
2. Add mailbox fetch contracts.
3. Add workspace state/checkpoint contracts.
4. Add bounded runtime log event contracts.
5. Add runner nudge/status contracts.
6. Add semantic side-input contracts for share, vault-sync, raw payload, device-sync, usage, and issues where they still need shared web/Cloudflare parsing.
7. Add parsers for those contracts.
8. Add route builders for those contracts.
9. Keep old run contracts temporarily only until call sites are deleted in this branch.

In `packages/cloudflare-hosted-control`:

1. Add nudge/status route builders.
2. Replace `nudgeUserRun` naming with runner/wake naming.
3. Remove committed seq, target seq, run id, and run-drain result fields from the new response types.

In `packages/assistant-runtime`:

1. Add `HostedRuntimePlatform` ports:
   - `mailboxPort.fetch`
   - `workspacePort.checkpoint`
   - `logPort.write`
   - semantic effect and side-input ports
2. Keep the port implementation fake/in-memory in tests first.
3. Do not wire these ports to old run-drain result/finalization types.

Suggested types:

```text
HostedMailboxLane = "conversation" | "system"
HostedMailboxItemRecord
HostedMailboxLaneCounterState
HostedMailboxFetchRequest
HostedMailboxFetchResponse
HostedWorkspaceRecord
HostedWorkspaceCheckpointRequest
HostedWorkspaceCheckpointResponse
HostedRuntimeLogRequest
HostedRuntimeStatusResponse
HostedRunnerNudgeResult
```

Acceptance:

- New parser tests cover malformed payloads and do not allow plaintext fields in log contracts.
- Log contracts accept event codes and allowlisted fields, not free-form messages.
- Old and new contracts are not wired together.
- `packages/cloudflare-hosted-control` can express nudge/status without `runId` or committed seq fields.
- Runtime test fakes can call `mailbox.fetch`, `workspace.checkpoint`, and `log.write` without web or Cloudflare code.

### Phase 2: Build Runtime Workspace Runner First

This is the highest-leverage order change from the final review. Prove the runtime-owned behavior before changing web storage or Cloudflare runner code.

In `packages/assistant-runtime`:

1. Add `runHostedWorkspaceUntilIdleOrBudget`.
2. Add null-snapshot bootstrap support.
3. Add hosted mailbox import state helpers for `vault/.runtime/operations/assistant/hosted-mailbox.json`.
4. Add mailbox fetch/import loop with per-lane strict prefixes.
5. Import conversation mailbox items into the same inbox/capture paths used locally.
6. Checkpoint immediately after import progress through `workspacePort.checkpoint`.
7. Do not use inbox `source_cursor` for hosted mailbox progress.
8. Export imported-through data only as a redacted status/GC projection.

Runtime import routing:

```text
conversation.message -> local inbox/capture import
member.activated -> hosted bootstrap into empty workspace
member.channels.updated -> channel reconciliation
assistant.notification.requested -> notification work
device-sync.wake -> device-sync work
vault.share.accepted -> sharePort fetch + import
vault.sync.import -> vaultSyncPort fetch + import
```

Acceptance:

- Package tests prove restore/null workspace, mailbox fetch, import, and checkpoint-after-import with fake ports.
- Importing the same mailbox fetch twice is idempotent.
- Runtime advances lane watermarks only after durable local import.
- Conversation import checkpoints canonical vault changes plus portable assistant runtime state.
- Malformed mailbox items quarantine in runtime state, not web state.
- Temporary missing raw payloads do not advance the lane.
- No code path reads or writes hosted mailbox watermarks through inbox `source_cursor`.

### Phase 3: Wire Hosted Turn Revision And Outbox In Runtime

In `packages/assistant-runtime` and `packages/assistant-engine`:

1. Inject the mailbox-backed turn-input port in hosted automation from day one.
2. On `before_delivery`, fetch/import/checkpoint new conversation mailbox items after the runtime watermark.
3. Delegate to the existing local `listNewConversationCaptures` and `AssistantTurnRevisionRequiredError` loop.
4. Add hosted outbox drain using existing local outbox statuses and receipts.
5. Checkpoint outbox intent creation before dispatch.
6. Mark intent `sending` and checkpoint before provider dispatch.
7. Checkpoint sent, failed, confirmation-pending, retry, reconcile, or abandoned state according to the existing local model.
8. Remove hosted side-effect journal/finalization methods from the new platform surface.

Acceptance:

- Regression test: first message starts reply, second same-conversation message arrives during tools/model, `before_delivery` imports it, reply is revised before send.
- Regression test: bounded revision budget defers delivery if new same-conversation input keeps arriving.
- Crash after outbox intent checkpoint but before provider call retries safely.
- Crash after provider call but before receipt checkpoint produces confirmation/reconcile behavior, not blind duplicate send.
- No hosted test asserts web-owned adoption or a hosted-only ambiguous status.

### Phase 4: Replace Web Schema And Mailbox Store

In `apps/web`:

1. Replace Prisma models:
   - remove `HostedExecutionCursor`
   - remove `HostedRun`
   - remove `HostedRunLog`
   - remove run fields from ingress/mailbox
   - add `HostedMailboxItem`
   - add `HostedMailboxPayload`
   - add `HostedMailboxLaneCounter`
   - add `HostedWorkspace`
   - add `HostedRuntimeLog`
2. Remove old `HostedMember` relation fields pointing at cursor/ingress/run/log rows.
3. Remove vault-sync queued run/ingress coupling, including queued event ids and run-summary commit helpers.
4. Replace `hosted-ingress` store with `hosted-mailbox` store.
5. Keep append helpers simple:
   - assign lane
   - allocate lane seq from lane counter
   - encrypt payload
   - insert row
   - return duplicate if dedupe collision
6. Remove web coalescing/replacement aliases.
7. Implement signed internal mailbox fetch route.
8. Implement signed internal workspace read/checkpoint routes.
9. Implement signed internal runtime log route.
10. Implement status read path from workspace plus mailbox lag.
11. Update all hosted producers to append mailbox items instead of hosted ingress events.
12. Keep best-effort Cloudflare nudge after transaction commit.

Acceptance:

- Web tests prove every producer appends exactly one mailbox item in the same transaction as its product mutation.
- Duplicate dedupe keys return existing mailbox item and do not create a second row.
- Duplicate dedupe keys with changed payloads never rewrite the first item.
- Checkpoint CAS rejects wrong expected version.
- Status computes mailbox lag by lane without reading plaintext payloads.
- Vault-sync import readiness no longer depends on hosted run commit/finalize summaries.
- Old hosted-run API route tests are removed, not updated to new internals.

### Phase 5: Replace Cloudflare Runner Job Shape

In `apps/cloudflare` and `packages/assistant-runtime`:

1. Add a new `WorkspaceRunner`; do not adapt `RunnerRunProcessor`.
2. Replace run-drain job input:

```text
HostedWorkspaceInvocationRequest {
  attemptId
  userId
  leaseGeneration
  workspaceVersion
  reason
  budget
}
```

3. Replace run result:

```text
HostedWorkspaceInvocationResult {
  status: "idle" | "budget_exhausted" | "scheduled" | "failed"
  nextWakeAt
  redactedStatus
}
```

4. Let checkpoints happen through `workspacePort` during execution.
5. Final result is a status summary only. It is not a commit record.
6. Remove run token from child env and replace with runtime bridge token.
7. Remove direct child web signing credentials and web route names.

Acceptance:

- Child can checkpoint after import before model/tool execution.
- Parent can kill child after checkpoint and next run restores imported state.
- Stale child cannot checkpoint after lease generation changes.
- Child has no web callback signing key and no full supervisor env.

### Phase 6: Simplify Cloudflare Durable Object

In `apps/cloudflare`:

1. Replace state schema.
2. Replace `runDrainLock` with a generic invocation lock.
3. Replace acquire loop with one `runUntilIdleOrBudget`.
4. Replace alarm behavior:
   - read `next_alarm_at` as a local alarm cache
   - refresh `HostedWorkspace.nextWakeAt` from web when deciding whether to run
   - if due, run once
   - reschedule from latest runtime projection
5. Replace nudge behavior:
   - if running, set alarm to now and return `alreadyRunning: true`
   - otherwise set alarm to now and optionally start run depending current route behavior
6. Replace status behavior with DO state plus web workspace status.
7. Delete committed seq and target seq responses.
8. Replace `runtime_bootstrapped` only after bootstrap/key-store resolution is independent from `bootstrapUser`.

Acceptance:

- DO has no `active_run_id`.
- DO has no event/run attempt columns.
- DO status still answers whether work is in flight and when the next wake is due.
- Workerd tests cover alarm/nudge coalescing and stale lease fencing.
- Key-store/bootstrap resolution works without writing runner bootstrap completion state.

### Phase 7: Collapse Cloudflare Runtime Bridge

In `apps/cloudflare`:

1. Keep semantic ports in `runtime-platform.ts`.
2. Keep worker-owned web callback signing in parent only.
3. Keep child env scrubbed.
4. Keep per-invocation cache/temp roots.
5. Keep process-group reaping.
6. Remove per-run outbound proxy token rotation.
7. Add per-lease bridge token validation through the current UserRunner lease.
8. Replace multiple internal worker hostnames with one runtime bridge where practical.

Acceptance:

- Child has no web callback signing key.
- Child has no full supervisor env.
- Bridge token is not present in URLs.
- Local loopback proxy, if still needed, preserves the same header-token contract.
- Checkpoint-capable bridge calls are rejected if the lease generation is stale even when the container token is otherwise valid.

## Current Remaining Work Map

As of the active deletion wave, the migration is partially landed and the
checkout is already past the first destructive web cleanup. Treat this as the
current checkout status, not the abstract target.

Already landed:

- Shared mailbox/workspace/runtime-log/runner contracts exist additively in
  `packages/hosted-execution`.
- `packages/hosted-execution` has explicit `HostedWorkspaceInvocationRequest` and
  `HostedWorkspaceInvocationResult` parsers that reject removed run fields such as
  `run`, `runDrain`, `runToken`, `targetCommittedSeqHint`, and `wake`.
- Web has additive hosted mailbox/workspace stores and signed internal
  mailbox/workspace/log route groundwork.
- Runtime has hosted mailbox import state, strict-prefix mailbox import,
  mailbox checkpoint rollback, before-delivery mailbox refresh, and checkpoint
  version carry-forward inside one invocation.
- Runtime now has a semantic snapshot checkpoint builder: checkpoint creation
  can snapshot the local workspace after mailbox import has mutated portable
  runtime state, instead of requiring web or Cloudflare to provide a stale
  precomputed `snapshotRef`.
- Runtime has an additive workspace invocation job entrypoint,
  `runHostedWorkspaceRuntimeJobInProcess`, that accepts
  `HostedWorkspaceInvocationRequest`, fails closed without mailbox/workspace/read
  ports, reads current workspace before mailbox import, rejects stale workspace
  versions before fetching mailbox items, imports and checkpoints the mailbox
  prefix, runs the assistant/outbox phase through local runtime semantics, and
  returns a run-free `HostedWorkspaceInvocationResult`.
- The workspace invocation job now restores the existing hosted snapshot into the
  local vault root before mailbox import, or creates a local null-bootstrap
  workspace when web has no snapshot yet. Missing snapshot bytes fail closed
  before any mailbox fetch/import/checkpoint work.
- Cloudflare runtime platform has mailbox/workspace/log/share/vault-sync/device
  callback ports and a workspace read port.
- Cloudflare node/container transport now has an additive discriminated
  `workspace-invocation` job envelope parsed at the container HTTP boundary, DO invoke
  boundary, isolated child boundary, and child-stdin boundary. Workspace jobs
  route toward `runHostedWorkspaceRuntimeJobInProcess` with real snapshot,
  checkpoint, conversation mailbox import, and vault-sync mailbox import bridge
  adapters.
- Cloudflare exposes a run-free runner nudge route and a runner-status route.
- Web handoff calls the runner nudge route through the configured control
  client.
- Web nudge helpers have moved from `hosted-ingress/control` to
  `hosted-runner/control`, and the run-worded helper names are gone from active
  web producer/control call sites.
- `packages/cloudflare-hosted-control` now exposes browser-vault session,
  runner status, and runner nudge only; its legacy `/run`, `getStatus`, and
  `nudgeUserRun` client surfaces are gone.
- Cloudflare's public control router no longer exposes the legacy
  `/internal/users/:userId/run` route; runner nudge goes through
  `/internal/users/:userId/nudge`.
- Cloudflare has a lease-scoped checkpoint bridge foundation split into
  composable pieces: one helper snapshots and writes a workspace bundle under
  the current lease, one helper validates lease before web checkpoint, and the
  full helper composes both. This shape fits the runtime semantic snapshot
  builder without double-checkpointing.
- `HostedUserRunner` has an additive `runUntilIdleOrBudget({ reason })` path
  that acquires the runner lease, reads the latest hosted workspace, invokes one
  `workspace-invocation` container job, clears invocation state, and schedules the next
  alarm from the workspace projection or pending nudge.
- Web vault-sync upload now writes the side input, updates the session, appends
  a `vault.sync.import` mailbox item in the same transaction, and nudges the
  runner best-effort after commit. Hosted-run commit/finalize no longer owns
  vault-sync session completion.
- Runtime-owned vault-sync mailbox import now fetches the side input through
  `vaultSyncPort`, runs the local vault-sync merge helper, records terminal
  import metrics through the semantic port, and advances/quarantines mailbox
  progress according to runtime import outcomes.
- Web's executor-facing hosted-run routes, `src/lib/hosted-run/**` helpers,
  and `src/lib/hosted-ingress/**` helpers have been deleted in the active
  checkout.
- Web producers now append mailbox items and nudge the run-free runner helper.
- The destructive Prisma pass now drops old hosted execution cursor/run/ingress
  tables and the old ingress behavior enum. The privacy/schema guard test has
  been updated so old models cannot silently return.
- Cloudflare run-finalization, wake-input, turn-input, run-result validation,
  and run-processor modules have been deleted from the active checkout.
- Shared hosted-execution run-control and ingress-control parser modules have
  been deleted, and the active shared contract surface is mailbox/workspace/log
  plus runner nudge/status.
- Live architecture docs now describe the mailbox/checkpoint protocol. Historical
  completed exec plans may still mention old terminology, but live docs should
  not treat it as current.

Remaining implementation work before final handoff is verification/audit only:

1. Run the focused hosted web, assistant-runtime, hosted-execution, and
   Cloudflare checks.
2. Run root/app typecheck where feasible.
3. Run the required security/privacy, coverage, simplify, and final-review
   audit passes for this high-risk cross-cutting diff.
4. Fix only findings that reveal real migration gaps; do not reintroduce web
   run adoption/finalize semantics.

### Phase 8: Delete Old Protocol

Delete old files after all call sites are gone:

```text
apps/cloudflare/src/user-runner/run-finalization.ts
apps/cloudflare/src/user-runner/wake-inputs.ts
apps/cloudflare/src/runner-outbound/turn-input.ts
packages/hosted-execution/src/parsers/run-control.ts
```

Then remove old symbols:

```text
HostedExecutionCursor
HostedRun
HostedRunLog
HostedIngressEvent
HostedIngressEventAlias
HostedIngressPayload
HostedRuntimeDrainRequest
HostedRunEventResult
HostedRunCleanupTarget
HostedRunTriggerKind
```

Run `rg` checks:

```text
rg "HostedRun|HostedExecutionCursor|runDrain|committedSeq|finalizeRequired|turn-input/adopt|turn-input/peek"
```

Only historical migration docs or explicitly obsolete docs should match.

Acceptance:

- No production code imports run-control contracts.
- No route under `/api/internal/hosted-run` remains unless renamed for a non-run purpose.
- No Cloudflare path calls acquire/commit/finalize.
- `packages/cloudflare-hosted-control` no longer exposes run-shaped client names or result fields.

### Phase 9: Update Docs And Deploy Surface

Update:

- `ARCHITECTURE.md`
- `docs/architecture.md` if it mentions hosted execution
- `apps/web/README.md`
- `apps/cloudflare/README.md`
- `apps/cloudflare/DEPLOY.md`
- `packages/assistant-runtime/README.md`
- `packages/hosted-execution/README.md`
- `packages/cloudflare-hosted-control` docs/source comments
- `agent-docs/references/hosted-runtime-protocol.md` replacement or removal
- `agent-docs/index.md` if canonical docs are added, removed, moved, or materially repurposed

Do not list this `migration.md` in the canonical docs index unless it becomes durable architecture rather than a point-in-time migration guide.

Acceptance:

- Docs describe mailbox/checkpoint as current target.
- Docs do not tell future agents to preserve web-owned hosted runs.
- Deploy docs name the new routes/env vars.

## End-To-End Scenarios To Prove

### 0. First Activation Bootstraps Empty Workspace

```text
Given HostedWorkspace has version 0 and null snapshotRef
And system lane contains `member.activated` seq 1
When Cloudflare runs the workspace
Then runtime creates the hosted vault/operator runtime state
And checkpoints version 1
And no bootstrap run, activation cursor, or web completion row exists
```

### 1. Import Survives Timeout

```text
Given mailbox has conversation lane seq 1
When runner imports seq 1 and checkpoints
And runner times out during model/tool execution
Then next runner restores a workspace containing seq 1 as local inbox/capture state
And seq 1 is not fetched/imported as new work again
```

### 2. Late Same-Conversation Message Revises Reply

```text
Given seq 1 starts an assistant reply
And provider/tool work is still running
When seq 2 arrives in the conversation lane
Then before delivery the runtime fetches seq 2
And imports/checkpoints seq 2
And local turn-input detects same-conversation capture
And the assistant reruns the reply with seq 1 and seq 2
And only the revised reply is delivered
```

### 3. Late Input Budget Exhaustion Defers

```text
Given new same-conversation messages keep arriving before delivery
When the local revision budget is exhausted
Then hosted defers delivery exactly as local does
And nextWakeAt is projected for retry
```

### 4. Temporary Payload Missing

```text
Given a mailbox item points at raw email payload
And the raw payload is temporarily missing
When runtime imports the conversation lane
Then it does not advance importedSeq for that lane
And logs a redacted retryable error
And schedules a retry
```

### 5. Permanent Malformed Payload

```text
Given a mailbox item payload cannot be parsed
When runtime imports the lane
Then it records quarantine in hosted-mailbox import state
And advances importedSeq
And logs redacted error metadata
And web mailbox state remains append-only
```

### 6. Outbox Crash Before Provider Call

```text
Given assistant created an outbox intent
And runtime checkpointed it
When runner dies before provider call
Then next run dispatches the same intent by stable idempotency key
```

### 7. Outbox Crash After Provider Call

```text
Given assistant began dispatch
And provider may have accepted the send
When runner dies before receipt checkpoint
Then next run uses the existing receipt/confirmation/reconcile path
And does not blindly duplicate non-idempotent sends
```

### 8. Stale Runner Cannot Checkpoint

```text
Given runner A has lease generation 1
And runner B supersedes it with generation 2
When runner A attempts a checkpoint
Then web or Cloudflare rejects it
And latest workspace pointer remains generation 2 work
```

### 9. Runtime Timer

```text
Given runtime projects nextWakeAt
When DO alarm fires
Then Cloudflare runs the workspace without creating any mailbox item
And runtime decides what work is due from local state
```

### 10. Status Without Runs

```text
Given recent mailbox, checkpoints, and logs
When status is read
Then response shows inFlight, nextWakeAt, workspaceVersion, mailbox lag, last error, and recent redacted logs
And it does not expose run ids or plaintext payloads
```

### 11. Duplicate Producer Retry Is First-Wins

```text
Given a producer appends a mailbox item with dedupeKey K
When the producer retries K with the same payload
Then web returns the existing item
And no new laneSeq is allocated
When the producer retries K with a different payload
Then web still returns the existing item
And emits only a redacted conflict log
And never rewrites the original mailbox row
```

### 12. Hosted Turn-Input Port Is Injected

```text
Given hosted automation is running
When the assistant reaches before-delivery refresh
Then runtime uses the mailbox-backed hosted turn-input port
And does not call web peek/adopt
And does not rely on the default local inbox-backed port being auto-created
```

### 13. Vault-Sync Import Has No Run Coupling

```text
Given a vault-sync import payload is ready
When web records product readiness
Then it appends a `vault.sync.import` mailbox item
And stores no queued run id, queued ingress event id, or run-summary commit dependency
And runtime imports through `vaultSyncPort`
```

### 14. Child Has No Web Credentials

```text
Given a hosted runner child is launched
Then the child has only the short-lived bridge token and semantic runtime config
And has no web signing secret, direct web base URL, or supervisor env
When the child checkpoints with a stale lease generation
Then UserRunner rejects the bridge call before web CAS
```

## Verification Plan

Use focused checks while developing, then full acceptance before landing the cut.

Focused lanes:

```text
pnpm --dir packages/hosted-execution test
pnpm --dir packages/assistant-runtime test
pnpm --dir apps/cloudflare test
pnpm --dir apps/cloudflare test:workers
pnpm --dir apps/web test
pnpm typecheck
```

Diff-aware lane when the branch is coherent:

```text
pnpm test:diff packages/hosted-execution apps/web apps/cloudflare packages/assistant-runtime packages/assistant-engine
```

Final lane:

```text
pnpm verify:acceptance
```

Cloudflare final-image smoke should be updated after the job shape changes:

```text
pnpm --dir apps/cloudflare runner:docker:smoke
```

Add or update tests for:

- Prisma mailbox append/dedupe/lane seq.
- Web checkpoint CAS.
- Web mailbox fetch route auth and redaction.
- Runtime mailbox import idempotency.
- Runtime mailbox quarantine.
- Runtime mailbox state does not use inbox `source_cursor`.
- Hosted mailbox-backed turn-input injection.
- Hosted before-delivery late-message revision.
- Cloudflare stale lease checkpoint rejection.
- Cloudflare alarm/nudge coalescing.
- Cloudflare child env contains no web signing credentials.
- `packages/cloudflare-hosted-control` nudge/status naming and no run-result fields.
- Vault-sync import readiness without run-summary commit coupling.
- Outbox crash/retry/ambiguous hosted flows.
- Status/log privacy.

## Deployment Cut Sequence

Because there are no users, do not build compatibility migrations.

Recommended sequence:

1. Stop hosted execution deployments.
2. Apply destructive web DB migration.
3. Clear old hosted-run rows/tables.
4. Clear old transient run/ingress payload objects if they exist.
5. Deploy web with mailbox/workspace routes.
6. Deploy Cloudflare with mailbox/checkpoint runner.
7. Run activation smoke.
8. Run conversation smoke.
9. Run late-message revision smoke.
10. Run timeout-after-import smoke.
11. Run outbox crash/retry smoke.
12. Enable normal hosted wake paths.

Bucket cleanup:

- Keep encrypted workspace bundle/artifact prefixes if they are still valid for the new checkpoint format.
- Delete old run-specific sidecar prefixes.
- Keep lifecycle rules for transient raw payloads.
- Ensure orphan bundle/artifact GC works after CAS conflicts.

## Main Risks And Mitigations

### Risk: Runtime Checkpoints Too Often

Mitigation:

- Always checkpoint after import and before/after side-effect boundaries.
- Batch low-risk maintenance checkpoints.
- Skip bundle rewrite when content hash is unchanged.

### Risk: Web Status Loses Debug Detail

Mitigation:

- Replace run logs with structured runtime logs.
- Add mailbox lag by lane.
- Add checkpoint reason and version.
- Add redacted runtime status projection.

### Risk: Side Effects Duplicate

Mitigation:

- Use local outbox as correctness.
- Checkpoint before dispatch.
- Use stable idempotency keys.
- Treat unknown post-send failures as ambiguous.
- Reconcile or require confirmation for non-idempotent sends.

### Risk: System Lane Ordering Is Too Loose

Mitigation:

- Keep strict order within `system`.
- If a specific system input must be ordered against conversation input, make the runtime importer enforce a readiness gate.
- Activation, channel binding, and payload availability are runtime import prerequisites, not web executor ordering rules.
- Do not make web a global executor queue again.

### Risk: Imported-Mailbox Projection Becomes Truth

Mitigation:

- Mailbox imported-through data appears only inside `HostedWorkspace.redactedStatusJson`.
- Runtime state inside the encrypted checkpoint is authoritative.
- Web must never use the projection to skip runtime import.

### Risk: Runtime Bridge Recreates A Hidden Run Protocol

Mitigation:

- Bridge endpoints are semantic ports only.
- No `runId`.
- No run token.
- No acquire/commit/finalize.
- No event completion mutations.
- Bridge auth is scoped to user id, lease generation, and attempt id.
- Checkpoint-capable calls validate the current UserRunner lease, not only container-token ownership.

### Risk: Runtime Checkpoint Port Becomes Finalization

Mitigation:

- `workspacePort.checkpoint` is a single CAS operation.
- No prepare, finalize, release, adopted event results, cleanup targets, or checkpoint status rows.
- Checkpoint returns the new workspace version or fails.
- CAS or lease conflict stops the runner and retries from web's latest workspace pointer.

## Hard Decisions

- Delete web-owned `HostedRun`.
- Delete web-owned `HostedExecutionCursor`.
- Delete web-owned turn-input adopt.
- Delete prepared/finalize split.
- Delete per-event running/completed/quarantined state in web.
- Delete web coalescing aliases for first cut.
- Delete global execution sequencing.
- Delete Cloudflare-hosted-control run naming.
- Delete vault-sync queued run/ingress completion coupling.
- Delete hosted-only side-effect status vocabulary.
- Keep mailbox append-only.
- Keep only per-lane mailbox counters.
- Keep Cloudflare lease-only.
- Keep runtime checkpoint as the only commit.
- Preserve logs/status as redacted projections, not correctness state.

## Definition Of Done

- Hosted execution no longer has a run lifecycle in production code.
- Cloudflare can run a hosted workspace from latest checkpoint to idle/budget without acquiring work from web.
- Web can append mailbox items and nudge Cloudflare without knowing execution outcome.
- Runtime can import mailbox items and checkpoint before long-running work.
- Runtime mailbox watermarks live only in hosted runtime state, not inbox connector cursors.
- Late same-conversation input before delivery revises the reply.
- Local outbox semantics are used for hosted delivery.
- Child runtime has no direct web credentials.
- Vault-sync import readiness and completion are not tied to hosted run summaries.
- Docs match the new architecture.
- `rg` finds no live run-centric protocol symbols outside obsolete migration/history references.
- Required verification is green or unrelated failures are documented with exact failing targets.
