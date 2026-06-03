# Giant File Composability Seams

Last verified: 2026-06-02

Murph is still greenfield, so the bias here is to cut cleaner module seams before compatibility glue, broad helper surfaces, and public re-export paths harden around accidental file shape.

## 1,000-line touch-time rule

No hand-authored repo file should be created or extended beyond 1,000 lines.
For repo code, docs, tests, and config work, check the line count before adding
to a file that is already large or known oversized. If the file is over 1,000
lines, split it along a real ownership seam first, then make the intended
change in the smaller owner module.

This is a composability rule, not a request for arbitrary file chopping. A good
split gives a responsibility a name, keeps public entrypoints narrow, preserves
local invariants, and avoids compatibility shims unless they are temporary and
legacy-facing. Prefer extracting one coherent helper or responsibility cluster
at a time over creating broad utility barrels.

Generated artifacts, vendored content, lockfiles, and tool-owned output are not
manual split targets. If one of those grows past the limit, fix the owning
generator/tooling or document the exception in the task handoff rather than
editing the artifact into artificial pieces.

Existing oversized hand-authored files are not an immediate repo-wide migration
unless the task is explicitly a giant-file cleanup. The rule applies when a task
touches the file: do not add more behavior, tests, config, or docs there until
the file has been made smaller and more composable.

## Implemented in this patch

### 1. Removed hosted pending-usage Cloudflare storage

**Seam:** historical `apps/cloudflare/src/usage-store.ts`, `apps/cloudflare/src/usage-store/dirty-users.ts`, and worker-route pending-usage storage paths

Historical note: Cloudflare previously carried two hosted pending-usage storage concerns:

- per-user hosted usage record append/read/delete
- cross-user dirty-marker persistence and scanning (`createHostedPendingUsageDirtyUserStore`, `writeHostedPendingUsageDirtyUser`, `deleteHostedPendingUsageDirtyUser`, `parseStoredHostedPendingUsageDirtyUser`)

Those paths shared the same bucket and crypto primitives, but they did not share the same responsibility boundary. One owned user-scoped usage records; the other owned scheduler-facing dirty-user markers.

Hosted assistant usage is now recorded directly into the web-owned usage ledger through the hosted-execution callback contract. The normal path no longer has Cloudflare-owned pending usage record storage or dirty-user marker storage.

**Why this is simpler:** there is no Cloudflare usage storage owner to split or preserve. Idempotency lives in the web ledger by `usageId`, and the runner only invokes a narrow best-effort recording port.

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
