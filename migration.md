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
- `packages/assistant-runtime/src/hosted-runtime/execution.ts`
  - `executeHostedRunDrainForCommit`
  - `completeHostedRunDrainAfterCommit`
  - adopted event results
  - adopted cleanup targets
- `packages/assistant-runtime/src/hosted-runtime/turn-input.ts`
  - runtime wrapper around web-owned hosted turn-input adoption
- `packages/assistant-runtime/src/hosted-runtime/callbacks.ts`
  - committed side-effect phase that mirrors local outbox into a hosted finalize protocol

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
  globalSeq               BigInt       @map("global_seq")
  eventId                 String?      @map("event_id")
  dedupeKey               String?      @map("dedupe_key")
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
  @@unique([userId, globalSeq])
  @@unique([userId, dedupeKey])
  @@index([userId, lane, laneSeq])
  @@index([userId, kind, globalSeq])
  @@index([userId, expiresAt])
  @@map("hosted_mailbox_item")
}
```

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
  importedMailboxJson     Json?        @map("imported_mailbox_json")
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
- `importedMailboxJson` is a redacted projection for status only. Runtime mailbox import state remains inside the checkpoint.
- `nextWakeAt` is a projection from runtime state, not a web-owned timer event.

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
  message            String
  attemptId          String?      @map("attempt_id")
  leaseGeneration    BigInt?      @map("lease_generation")
  workspaceVersion   BigInt?      @map("workspace_version")
  checkpointVersion  BigInt?      @map("checkpoint_version")
  mailboxLane        String?      @map("mailbox_lane")
  mailboxSeqStart    BigInt?      @map("mailbox_seq_start")
  mailboxSeqEnd      BigInt?      @map("mailbox_seq_end")
  outboxIntentId     String?      @map("outbox_intent_id")
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
- `globalSeq` exists only for debugging/correlation across lanes.
- Web assigns lane seqs atomically at append time.
- Runtime imports strict prefixes per lane.
- A temporary missing payload stops that lane only.
- A malformed permanent item is quarantined in runtime import state, logged, and the lane advances.
- Web does not mark mailbox rows running, completed, or quarantined.

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
  "eventIds": {},
  "lastRefreshAt": null
}
```

Rules:

- Use `packages/runtime-state` versioned JSON helpers.
- `importedSeq` advances only after durable local import has completed.
- Runtime checkpoints after any import progress.
- `eventIds` maps hosted mailbox event ids to local capture/import ids only when useful for idempotency or debug.
- Quarantine entries contain only event id, lane, lane seq, kind, sanitized error code, and timestamp.
- No plaintext message bodies or provider payloads in this state file.

## Runtime Platform Contract

Replace run-shaped platform ports with mailbox/checkpoint-shaped ports.

Suggested shape:

```ts
interface HostedRuntimePlatform {
  artifactStore: HostedRuntimeArtifactStore;
  mailboxPort: {
    fetch(input: {
      lanes: readonly HostedMailboxLaneCursor[];
      limitPerLane: number;
      requestId: string;
    }): Promise<HostedMailboxFetchResult>;
  };
  workspacePort: {
    checkpoint(input: HostedWorkspaceCheckpointInput): Promise<HostedWorkspaceCheckpointResult>;
  };
  logPort: {
    write(entries: readonly HostedRuntimeLogEntry[]): Promise<void>;
  };
  effectsPort: HostedRuntimeEffectsPort;
  deviceSyncPort?: HostedRuntimeDeviceSyncPort | null;
  usageExportPort?: HostedRuntimeUsageExportPort | null;
  issueExportPort?: HostedRuntimeIssueExportPort | null;
  billingPort?: HostedRuntimeBillingPort | null;
}
```

The child runtime should not know web routes. It should call semantic ports.

If the child must talk over HTTP because it runs in an isolated process, collapse the current multi-host internal proxy into one worker-owned runtime bridge:

```text
POST /__internal/runtime-bridge/mailbox/fetch
POST /__internal/runtime-bridge/workspace/checkpoint
POST /__internal/runtime-bridge/logs/write
GET  /__internal/runtime-bridge/payloads/email/:key
POST /__internal/runtime-bridge/effects/email/send
POST /__internal/runtime-bridge/device-sync/*
POST /__internal/runtime-bridge/usage/record
POST /__internal/runtime-bridge/issues/record
```

Keep one short-lived bridge token scoped to user id, lease generation, and attempt id. Do not keep per-run tokens because there are no runs.

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
  last_checkpoint_version TEXT,
  last_error_at TEXT,
  last_error_code TEXT,
  last_run_at TEXT,
  next_wake_at TEXT
);
```

Delete:

- `active_run_event_id`
- `active_run_id`
- `active_run_attempt`
- `active_run_started_at`
- `runtime_bootstrapped` if bootstrap can be inferred from workspace existence, or keep only if activation provisioning still needs a one-time local flag.
- `last_event_id`

Durable Object methods should become:

```text
bootstrapUser(userId)
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
5. Read encrypted snapshot ref from workspace.
6. Restore hosted execution context into a temp workspace.
7. Build hosted runtime platform ports.
8. Run hosted runtime until idle or budget.
9. Runtime checkpoints through workspacePort as it progresses.
10. Record final heartbeat/status and nextWakeAt.
11. Clear in_flight.
12. Schedule one DO alarm for nextWakeAt if present.
```

Important fencing:

- Every checkpoint includes expected workspace version and lease generation.
- Web accepts a checkpoint only if the expected workspace version matches.
- Cloudflare accepts a checkpoint response only if the local lease generation is still current.
- A stale runner that wakes late may log, but it cannot advance the workspace.
- On CAS conflict, stop the runner and schedule a retry from the latest checkpoint. Do not merge snapshots.

## Hosted Runtime Algorithm

Add a new entrypoint:

```text
runHostedWorkspaceUntilIdleOrBudget(input)
```

The entrypoint should:

```text
1. Restore local workspace from the provided snapshot.
2. Refresh hosted mailbox for conversation and system lanes.
3. Import mailbox items into the same local inbox/runtime paths used by local execution.
4. Checkpoint immediately if any import progressed.
5. Run due local runtime work:
   - activation/bootstrap
   - channel reconciliation
   - conversation auto-reply
   - notification requests
   - device-sync work
   - share imports
   - vault-sync imports
   - outbox retry/reconciliation
6. Before delivery, refresh hosted mailbox again.
7. If new same-conversation captures arrived, checkpoint and throw/use `AssistantTurnRevisionRequiredError`.
8. Let the existing bounded local revision loop rerun the reply.
9. Checkpoint before and after external side-effect boundaries.
10. Export redacted status/logs and nextWakeAt.
11. Stop when idle or budget exhausted.
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

Hosted should use those primitives directly.

Target hosted refresh:

```text
1. The local assistant is about to deliver a draft.
2. `turnInputPort.refresh({ phase: "before_delivery" })` calls hosted mailbox fetch for the conversation lane after the runtime import watermark.
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
pending -> sending -> failed_ambiguous
```

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
5. Checkpoint when an intent reaches `sent`, `failed`, or `failed_ambiguous`.
6. Delete committed assistant delivery effects from the hosted run result path.
7. Reduce `packages/hosted-execution/src/side-effects.ts` to shared codecs only if a provider adapter still needs them. Otherwise delete it.

Current local tests around outbox retry, stale sending reconciliation, ambiguous errors, and receipts should become the correctness baseline for hosted too.

## Checkpoint Semantics

A checkpoint is the only hosted commit.

Checkpoint input:

```ts
interface HostedWorkspaceCheckpointInput {
  attemptId: string;
  expectedWorkspaceVersion: string;
  leaseGeneration: string;
  snapshotRef: HostedExecutionBundleRefState | null;
  browserVaultReplicaRef?: HostedBrowserVaultReplicaRef | null;
  nextWakeAt?: string | null;
  nextWakeReason?: string | null;
  redactedStatus?: Record<string, unknown> | null;
  importedMailbox?: Record<string, unknown> | null;
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
1. Runtime snapshots local workspace to a bundle.
2. Cloudflare writes bundle/artifacts to R2 using current encryption/keyring.
3. Runtime bridge calls web checkpoint with expected workspace version.
4. Web CAS updates `HostedWorkspace.version`, `snapshotRef`, status, nextWakeAt, and imported mailbox projection.
5. Web returns the new workspace version.
6. Runtime records the new version for later checkpoints in the same invocation.
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
4. Assign `lane` and `laneSeq`.
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
- Do not replace rows for coalescing in the first cut.

Payload storage:

- Keep inline ciphertext for small payloads.
- Keep payload table/object for large payloads.
- Raw email/message payloads remain encrypted side inputs with TTL/import GC.

## Raw Payload Cleanup

Delete per-run cleanup targets.

Use one of these simpler policies:

1. Time-based retention:
   - raw email/message payloads expire after a short retention window.
   - runtime tolerates missing raw payloads by logging and leaving the lane item unadvanced when the payload is temporarily missing.
2. Imported-through GC:
   - runtime status projection says lane seq imported through N.
   - a web cron deletes raw payloads for mailbox items older than a retention grace and imported through the projected seq.

For the first cut, prefer time-based retention plus imported-through best-effort GC. Do not make cleanup part of execution correctness.

## Status And Debugging

Preserve debugability without preserving runs.

Status response should include:

```text
userId
inFlight
leaseGeneration
heartbeatAt
lastRunAt
lastCheckpointVersion
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
message
mailbox lane/seq range
outboxIntentId
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

Delete:

- `src/lib/hosted-run/**`
- `app/api/internal/hosted-run/acquire/route.ts`
- `app/api/internal/hosted-run/commit/route.ts`
- `app/api/internal/hosted-run/finalize/route.ts`
- `app/api/internal/hosted-run/release-finalize/route.ts`
- `app/api/internal/hosted-run/turn-input/peek/route.ts`
- `app/api/internal/hosted-run/turn-input/adopt/route.ts`
- run-owned log/status routes after replacements exist

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
- `RunnerRunProcessor` with a smaller `WorkspaceRunner`
- `web-control-plane.ts` run clients with workspace/mailbox/log clients
- `runtime-platform.ts` turn-input port with mailbox/checkpoint/log ports
- multi-host internal proxy with one runtime bridge where possible

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
- `src/runner-container.ts` job input from run-drain request to workspace-run request.

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
- `createHostedAssistantTurnInputPort` to fetch/import/checkpoint mailbox items
- `HostedRuntimePlatform.turnInputPort` with `mailboxPort` plus local turn-input wrapper

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

1. Write the new ownership decision into durable docs after implementation starts:
   - `ARCHITECTURE.md`
   - `apps/web/README.md`
   - `apps/cloudflare/README.md`
   - `packages/assistant-runtime/README.md`
   - `packages/hosted-execution/README.md`
2. Mark `agent-docs/references/hosted-run-protocol.md` obsolete or replace it with a hosted mailbox/checkpoint protocol doc.
3. Add a short glossary:
   - mailbox item
   - mailbox lane
   - workspace checkpoint
   - lease generation
   - runtime import watermark
4. Decide the final route names before touching code.

Acceptance:

- Durable docs no longer describe web-owned run acquire/commit/finalize as the future target.
- The new protocol can be explained without `runId`, `committedSeq`, or `finalizeRequired`.

### Phase 1: Add New Shared Contracts

In `packages/hosted-execution`:

1. Add mailbox item contracts.
2. Add mailbox fetch contracts.
3. Add workspace state/checkpoint contracts.
4. Add runtime log contracts.
5. Add runner nudge/status contracts.
6. Add parsers for those contracts.
7. Add route builders for those contracts.
8. Keep old run contracts temporarily only until call sites are deleted in this branch.

Suggested types:

```text
HostedMailboxLane = "conversation" | "system"
HostedMailboxItemRecord
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
- Old and new contracts are not wired together.

### Phase 2: Replace Web Schema And Mailbox Store

In `apps/web`:

1. Replace Prisma models:
   - remove `HostedExecutionCursor`
   - remove `HostedRun`
   - remove `HostedRunLog`
   - remove run fields from ingress/mailbox
   - add `HostedMailboxItem`
   - add `HostedMailboxPayload`
   - add `HostedWorkspace`
   - add `HostedRuntimeLog`
2. Replace `hosted-ingress` store with `hosted-mailbox` store.
3. Keep append helpers simple:
   - assign lane
   - assign lane seq
   - assign global seq
   - encrypt payload
   - insert row
   - return duplicate if dedupe collision
4. Remove web coalescing/replacement aliases.
5. Implement signed internal mailbox fetch route.
6. Implement signed internal workspace read/checkpoint routes.
7. Implement signed internal runtime log route.
8. Implement status read path from workspace plus mailbox lag.
9. Update all hosted producers to append mailbox items instead of hosted ingress events.
10. Keep best-effort Cloudflare nudge after transaction commit.

Acceptance:

- Web tests prove every producer appends exactly one mailbox item in the same transaction as its product mutation.
- Duplicate dedupe keys return existing mailbox item and do not create a second row.
- Checkpoint CAS rejects wrong expected version.
- Status computes mailbox lag by lane without reading plaintext payloads.
- Old hosted-run API route tests are removed, not updated to new internals.

### Phase 3: Implement Runtime Mailbox Import

In `packages/assistant-runtime`:

1. Add hosted mailbox import state file helpers.
2. Add mailbox fetch/import loop.
3. Route each mailbox kind to existing runtime behavior:
   - `conversation.message` imports into inbox/capture state.
   - `member.activated` performs hosted bootstrap.
   - `member.channels.updated` reconciles assistant channels.
   - `assistant.notification.requested` enqueues/runs notification work.
   - `device-sync.wake` runs device-sync work.
   - `vault.share.accepted` fetches share payload and imports.
   - `vault.sync.import` fetches vault-sync payload and imports.
4. Checkpoint after any mailbox import progress.
5. On temporary side-input missing, stop advancing that lane and schedule retry.
6. On malformed permanent input, quarantine in runtime state, log, advance lane.
7. Export redacted imported lane projection for web status.

Acceptance:

- Importing the same mailbox fetch twice is idempotent.
- Runtime advances lane watermarks only after durable local import.
- Malformed mailbox item is quarantined in runtime state and not in web state.
- Temporary missing raw email payload does not advance the conversation lane.
- Imported conversation messages appear to local assistant automation exactly like local inbox captures.

### Phase 4: Replace Hosted Turn-Input Refresh

In `packages/assistant-runtime`:

1. Replace hosted turn-input port implementation.
2. On `before_delivery`, fetch conversation lane after runtime watermark.
3. Import any new conversation messages.
4. Checkpoint immediately.
5. Delegate to `createInboxBackedAssistantTurnInputPort.listNewConversationCaptures`.
6. Let `AssistantTurnRevisionRequiredError` propagate to the existing local revision loop.

In `apps/cloudflare` and `apps/web`:

1. Delete turn-input peek route.
2. Delete turn-input adopt route.
3. Delete runner outbound turn-input handler.

Acceptance:

- Regression test: first message starts reply, second same-conversation message arrives during tools/model, `before_delivery` imports it, reply is revised before send.
- Regression test: bounded revision budget defers delivery if new same-conversation input keeps arriving.
- No hosted test asserts web-owned adoption.

### Phase 5: Replace Runner Job Shape

In `apps/cloudflare` and `packages/assistant-runtime`:

1. Replace run-drain job input:

```text
HostedWorkspaceRunRequest {
  attemptId
  userId
  leaseGeneration
  workspaceVersion
  snapshotRef
  reason
  budget
}
```

2. Replace run result:

```text
HostedWorkspaceRunResult {
  status: "idle" | "budget_exhausted" | "scheduled" | "failed"
  checkpointVersion
  nextWakeAt
  redactedStatus
}
```

3. Prefer letting checkpoints happen through `workspacePort` during execution.
4. Final result should not carry the authoritative bundle unless the child cannot checkpoint directly.
5. Remove run token from child env and replace with runtime bridge token.

Acceptance:

- Child can checkpoint after import before model/tool execution.
- Parent can kill child after checkpoint and next run restores imported state.
- Stale child cannot checkpoint after lease generation changes.

### Phase 6: Simplify Cloudflare Durable Object

In `apps/cloudflare`:

1. Replace state schema.
2. Replace `runDrainLock` with a generic invocation lock.
3. Replace acquire loop with one `runUntilIdleOrBudget`.
4. Replace alarm behavior:
   - read `next_wake_at`
   - if due, run once
   - reschedule from latest runtime projection
5. Replace nudge behavior:
   - if running, set alarm to now and return `alreadyRunning: true`
   - otherwise set alarm to now and optionally start run depending current route behavior
6. Replace status behavior with DO state plus web workspace status.
7. Delete committed seq and target seq responses.

Acceptance:

- DO has no `active_run_id`.
- DO has no event/run attempt columns.
- DO status still answers whether work is in flight and when the next wake is due.
- Workerd tests cover alarm/nudge coalescing and stale lease fencing.

### Phase 7: Collapse Cloudflare Runtime Bridge

In `apps/cloudflare`:

1. Replace multiple internal worker hostnames where practical with one runtime bridge.
2. Keep semantic ports in `runtime-platform.ts`.
3. Keep worker-owned web callback signing in parent only.
4. Keep child env scrubbed.
5. Keep per-invocation cache/temp roots.
6. Keep process-group reaping.
7. Remove per-run outbound proxy token rotation.
8. Add per-lease bridge token validation.

Acceptance:

- Child has no web callback signing key.
- Child has no full supervisor env.
- Bridge token is not present in URLs.
- Local loopback proxy, if still needed, preserves the same header-token contract.

### Phase 8: Move Side Effects Fully To Runtime Outbox

In `packages/assistant-runtime` and `packages/assistant-engine`:

1. Delete hosted committed side-effect result path.
2. Add hosted outbox drain stage.
3. Inject hosted provider adapters into `dispatchAssistantOutboxIntent`.
4. Checkpoint before dispatch.
5. Checkpoint after receipt/failure/ambiguous result.
6. Preserve usage and issue export as best-effort runtime export ports.

Acceptance:

- Crash after outbox intent checkpoint but before provider call retries safely.
- Crash after provider call but before receipt checkpoint produces ambiguous/reconcile behavior, not blind duplicate send.
- Existing assistant-engine outbox retry policy tests remain the source of truth.
- Hosted tests no longer depend on web `committed_needs_finalize`.

### Phase 9: Delete Old Protocol

Delete old files after all call sites are gone:

```text
apps/web/src/lib/hosted-run/**
apps/web/app/api/internal/hosted-run/acquire/route.ts
apps/web/app/api/internal/hosted-run/commit/route.ts
apps/web/app/api/internal/hosted-run/finalize/route.ts
apps/web/app/api/internal/hosted-run/release-finalize/route.ts
apps/web/app/api/internal/hosted-run/turn-input/peek/route.ts
apps/web/app/api/internal/hosted-run/turn-input/adopt/route.ts
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

### Phase 10: Update Docs And Deploy Surface

Update:

- `ARCHITECTURE.md`
- `docs/architecture.md` if it mentions hosted execution
- `apps/web/README.md`
- `apps/cloudflare/README.md`
- `apps/cloudflare/DEPLOY.md`
- `packages/assistant-runtime/README.md`
- `packages/hosted-execution/README.md`
- `agent-docs/references/hosted-run-protocol.md` replacement or removal
- `agent-docs/index.md` if canonical docs are added, removed, moved, or materially repurposed

Do not list this `migration.md` in the canonical docs index unless it becomes durable architecture rather than a point-in-time migration guide.

Acceptance:

- Docs describe mailbox/checkpoint as current target.
- Docs do not tell future agents to preserve web-owned hosted runs.
- Deploy docs name the new routes/env vars.

## End-To-End Scenarios To Prove

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
Then next run marks/reconciles the intent as ambiguous
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
- Hosted before-delivery late-message revision.
- Cloudflare stale lease checkpoint rejection.
- Cloudflare alarm/nudge coalescing.
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
- If a specific system input must be ordered against conversation input, make the runtime importer enforce that by checking `globalSeq`.
- Do not make web a global executor queue again.

### Risk: Imported-Mailbox Projection Becomes Truth

Mitigation:

- `HostedWorkspace.importedMailboxJson` is status only.
- Runtime state inside the encrypted checkpoint is authoritative.
- Web must never use the projection to skip runtime import.

### Risk: Runtime Bridge Recreates A Hidden Run Protocol

Mitigation:

- Bridge endpoints are semantic ports only.
- No `runId`.
- No run token.
- No acquire/commit/finalize.
- No event completion mutations.

## Hard Decisions

- Delete web-owned `HostedRun`.
- Delete web-owned `HostedExecutionCursor`.
- Delete web-owned turn-input adopt.
- Delete prepared/finalize split.
- Delete per-event running/completed/quarantined state in web.
- Delete web coalescing aliases for first cut.
- Keep mailbox append-only.
- Keep Cloudflare lease-only.
- Keep runtime checkpoint as the only commit.
- Preserve logs/status as redacted projections, not correctness state.

## Definition Of Done

- Hosted execution no longer has a run lifecycle in production code.
- Cloudflare can run a hosted workspace from latest checkpoint to idle/budget without acquiring work from web.
- Web can append mailbox items and nudge Cloudflare without knowing execution outcome.
- Runtime can import mailbox items and checkpoint before long-running work.
- Late same-conversation input before delivery revises the reply.
- Local outbox semantics are used for hosted delivery.
- Docs match the new architecture.
- `rg` finds no live run-centric protocol symbols outside obsolete migration/history references.
- Required verification is green or unrelated failures are documented with exact failing targets.
