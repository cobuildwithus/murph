# Giant File Composability Seams

Last verified: 2026-04-14

Murph is still greenfield, so the bias here is to cut cleaner module seams before compatibility glue, broad helper surfaces, and public re-export paths harden around accidental file shape.

## Implemented in this patch

### 1. Split hosted pending-usage dirty-user tracking from per-user usage record storage

**Seam:** `apps/cloudflare/src/usage-store.ts`, `apps/cloudflare/src/usage-store/dirty-users.ts`, `apps/cloudflare/src/worker-routes/internal-user.ts`

`apps/cloudflare/src/usage-store.ts` was carrying two different storage concerns:

- per-user pending usage record append/read/delete (`createHostedPendingUsageStore`, `readStoredHostedPendingUsageRecordByUsageId`, `writeStoredHostedPendingUsageRecord`)
- cross-user dirty-marker persistence and scanning (`createHostedPendingUsageDirtyUserStore`, `writeHostedPendingUsageDirtyUser`, `deleteHostedPendingUsageDirtyUser`, `parseStoredHostedPendingUsageDirtyUser`)

Those paths share the same bucket and crypto primitives, but they do not share the same responsibility boundary. One owns user-scoped usage records; the other owns scheduler-facing dirty-user markers.

This patch moves the dirty-marker symbols into `apps/cloudflare/src/usage-store/dirty-users.ts` and updates the worker route to depend on that module directly.

**Why this is simpler:** changes to dirty-user listing or marker retention no longer widen the per-user usage record file. The remaining `usage-store.ts` keeps one narrower owner role: persisted usage records plus the record-side read/delete lifecycle.

**Follow-up path:** if the per-user record file grows again, the next safe cut is the record codec/object-key cluster (`parseStoredHostedPendingUsageRecord`, `pendingUsageRecordObjectKey`, `pendingUsageRecordObjectPrefix`) into a record-owned submodule without reintroducing a generic storage helper layer.

## Current targeted review findings

### Worth planning

#### 1. Split `RunnerQueueStore` by persistence concern before the Durable Object becomes the next accidental framework

**Seam:** `apps/cloudflare/src/user-runner/runner-queue-store.ts`

**Symbols/clusters:** `enqueueDispatch`, `claimNextDuePendingDispatch`, `applyCommittedDispatch`, `syncCommittedBundles`, `compareAndSwapBundleRefs`, `recordRunPhase`, `readPendingDispatch*`, `writeConsumedEventSync`, `writeQuarantinedEventSync`, `writeBackpressuredEventSync`

**Current cost:** one file owns pending queue storage, payload hydration, bundle compare-and-swap state, consumed/quarantined/backpressured event history, wake scheduling inputs, and run/timeline meta projection. Local changes are risky because readers have to keep several tables and invariants in mind at once.

**Simpler target:** keep `RunnerQueueStore` as the orchestration façade, but move concrete persistence seams into smaller modules such as:

- `user-runner/runner-queue/pending-dispatches.ts` for pending row CRUD and payload hydration
- `user-runner/runner-queue/event-history.ts` for consumed/quarantined/backpressured tables
- `user-runner/runner-queue/bundle-state.ts` for bundle slot reads and compare-and-swap

**Incremental extraction path:** move one helper cluster at a time behind context-aware module functions that receive `sql` and `dispatchPayloadStore`, without changing the SQL schema or the public `RunnerQueueStore` API first.

#### 2. Split assistant cron authoring/projection from claiming/execution

**Seam:** `packages/assistant-engine/src/assistant/cron.ts`

**Symbols/clusters:** `installAssistantCronPreset`, `addAssistantCronJob`, `setAssistantCronJobTarget`, `getAssistantCronStatus`, `listAssistantCronRuns`, `processDueAssistantCronJobs`, `claimNextDueAssistantCronJob`, `executeClaimedAssistantCronJob`, `finalizeAssistantCronJobAfterRun`, `runFoodAutoLogCronJob`

**Current cost:** cron job CRUD, schedule projection, due-job claiming, execution/finalization, and one domain-specific food autolog flow all live together. That makes small changes to scheduling or target resolution drag the execution path into scope, and vice versa.

**Simpler target:** separate the file into concrete cron responsibilities:

- `assistant/cron/jobs.ts` for CRUD and target-setting
- `assistant/cron/execution.ts` for claim/run/finalize logic
- `assistant/cron/food-auto-log.ts` for the food-specific job adapter

**Incremental extraction path:** move `runFoodAutoLogCronJob(...)` plus its helper types first, then move the claim/execute/finalize cluster out while leaving the current public exports and persistence format unchanged.

### Keep as-is

#### A. Keep `packages/core/src/mutations.ts` as one canonical mutation façade

**Seam:** `packages/core/src/mutations.ts`

**Exports:** `importDocument`, `addMeal`, `importSamples`, `importDeviceBatch`

This file is large, but the size comes from one real boundary: canonical high-level mutations that normalize operator input, prepare attachments, and stage a write through the shared write-batch path. Splitting the normalization helpers into multiple peer files too early would blur the fact that these exports are the top of the same write pipeline.

**Why keep it:** the helpers are tightly coupled to the four exported mutation façades and the canonical event/sample/document write semantics they share.

**Guardrail:** only split this file when a helper cluster clearly belongs to a stable record family with its own durable owner, not just because the helper section is long.

#### B. Keep `packages/core/src/operations/write-batch.ts` as one staged-write boundary

**Seam:** `packages/core/src/operations/write-batch.ts`

**Exports:** `isTerminalWriteOperationStatus`, `listWriteOperationMetadataPaths`, `isProtectedCanonicalPath`, `listProtectedCanonicalPaths`, `readStoredWriteOperation`, `readRecoverableStoredWriteOperation`, `runCanonicalWrite`

This file is also large, but it is large for one reason: it owns the lifecycle of staged canonical writes, metadata recovery, protected-path handling, and commit receipts.

**Why keep it:** the file describes one concrete state machine. Breaking it into several peer modules too early would make the write lifecycle harder to audit and easier to accidentally widen across trust boundaries.

**Guardrail:** prefer small internal helper moves only when they preserve `runCanonicalWrite(...)` as the obvious owner of the staged-write protocol.
