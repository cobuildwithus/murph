## Title

Make Cloudflare a stateless executor over the same vault/outbox model local Murph uses.

## Decision

Hosted execution should not own a second Cloudflare-specific lifecycle above the local Murph vault/outbox contract.
Cloudflare-specific state is acceptable only when it solves transport concerns that local Murph does not have, such as Durable Object lease ownership, alarm scheduling, web callback authentication, process/container supervision, and a minimal in-DO recovery handoff before the web cursor compare-and-swap completes.

This repo is greenfield for hosted execution with no live data to preserve.
That means deletion and direct cutover are preferred over compatibility scaffolding whose only job would be to replay historical hosted state.

Everything else should collapse back into the shared vault/runtime contract:

- canonical assistant continuity remains in `vault/**` plus portable `.runtime/**`
- assistant delivery continuity remains in the portable assistant outbox/receipts model
- hosted execution should commit the web cursor once with the final vault snapshot ref
- if a crash happens after a committed bundle exists but before that cursor commit, the only recovery seam should be a thin Durable Object-local pending-commit record that resumes finalization against the same vault/outbox model

## Implemented State

As of the final 2026-04-18 cutover, the hosted Cloudflare path now matches that target closely enough to treat this plan as landed:

- Cloudflare no longer owns `execution-journal.ts`, `side-effect-journal.ts`, or `runner-commit-recovery.ts`
- hosted assistant delivery recovery now trusts the shared portable outbox mirror directly
- the only Cloudflare-native recovery seam is `pending_commit_json` on `runner_meta`
- Cloudflare commits the web cursor once with the final bundle ref and does cleanup only after the cursor CAS
- worker-only duplicate-commit recovery now seeds and resumes the DO-local pending commit instead of a bespoke journal object
- the remaining `bundle_ref_json` / `bundle_version` pair is retained only as the local bundle cache and swap fence, not as a second correctness ledger

The one deliberate divergence from local one-shot execution is the retained `phase: "committed"` to `phase: "completed"` runtime seam. That seam now exists only to bridge the pre-cursor crash window onto the same vault/outbox model; it is no longer backed by any Cloudflare-specific journal substrate.

## Why This Plan Exists

The current hard-cut already moved canonical queue truth to web-owned `HostedWake` plus `HostedExecutionCursor`, but Cloudflare still owns a hosted-only recovery stack on top of the shared vault model:

- `apps/cloudflare/src/user-runner.ts`
  - executes wakes
  - commits a cursor update back to web
  - then runs `finalizeCommittedHostedWakesLocally(...)`
  - may perform a second cursor compare-and-swap when the finalized snapshot ref differs from the initially committed snapshot ref
- `apps/cloudflare/src/user-runner/runner-wake-processor.ts`
  - persists a durable committed result
  - resumes from that committed result
  - finalizes after cursor commit
- `apps/cloudflare/src/execution-journal.ts`
  - stores `assistantDeliveryEffects`, `bundleRef`, `committedAt`, `finalizedAt`, and `gatewayProjectionSnapshot`
- `apps/cloudflare/src/side-effect-journal.ts`
  - stores hosted assistant-delivery replay state outside the local outbox model
- `apps/cloudflare/src/user-runner/runner-state-schema.ts`
  - now persists one `bundle_ref_json` plus `bundle_version` on `runner_meta`

That shape is materially thinner than the old queue-owning design, but it is still not the same runtime model local Murph uses.

## Current Code Facts

### Landed already

- web owns canonical wake ordering and committed high-water through `HostedWake` and `HostedExecutionCursor`
- hosted assistant outbox and receipts are already portable under `.runtime/operations/assistant/**`
  - `packages/runtime-state/src/assistant-local-state-descriptors.ts`
- hosted runtime transport is already abstracted behind `HostedRuntimePlatform`
  - `packages/assistant-runtime/README.md`
- hosted runtime now prefers single-pass completion on the first invocation
  - `packages/assistant-runtime/src/hosted-runtime.ts`
  - the normal non-resume path now runs `executeHostedWakeForCommit(...)` and immediately drains post-commit work in-process
  - explicit `resume.committedResult` remains only as a fallback/recovery seam
- non-critical post-commit exports are now best-effort instead of forcing the hosted committed fallback
  - `packages/assistant-runtime/src/hosted-runtime/execution.ts`
  - committed gateway projection export, pending usage export, assistant status refresh, final gateway projection export, and browser-vault export no longer by themselves force `phase: "committed"`
- hosted delivery replay now trusts terminal portable outbox mirror states before falling back to the hosted journal
  - `packages/assistant-runtime/src/hosted-runtime/callbacks.ts`
  - this is intentionally limited to terminal mirror states; in-flight `sending` still stays on the journal path until the shared outbox becomes authoritative for that crash window
- Cloudflare now prefers direct final bundle commits for the happy path
  - `apps/cloudflare/src/user-runner/runner-wake-processor.ts`
  - `apps/cloudflare/src/user-runner.ts`
  - when the runtime returns a final result, Cloudflare writes the final bundle immediately, commits that final snapshot ref to web once, and only performs post-cursor cleanup
  - the old committed/journal/finalize path remains only as a compatibility fallback when the runtime returns `phase: "committed"`
- Cloudflare execution-journal no longer treats gateway projection as correctness state
  - `apps/cloudflare/src/execution-journal.ts`
- the old `runner_bundle_slots` table is already gone
  - Cloudflare now keeps only one local bundle cache on `runner_meta` through `bundle_ref_json` and `bundle_version`

### Remaining divergence from local Murph

1. Hosted runtime still exposes a two-phase result.
   - `packages/assistant-runtime/src/hosted-runtime.ts`
   - first call returns `phase: "committed"`
   - resume path later returns `phase: "completed"`

2. The first phase snapshots an intermediate bundle before post-commit delivery is drained.
   - `packages/assistant-runtime/src/hosted-runtime/execution.ts`
   - `executeHostedWakeForCommit(...)` snapshots the execution context and collects committed assistant delivery effects

3. The second phase drains committed side effects and snapshots a final bundle again.
   - `completeHostedExecutionAfterCommit(...)`

4. Cloudflare persists recovery artifacts for that two-phase contract.
   - `apps/cloudflare/src/execution-journal.ts`
   - `apps/cloudflare/src/side-effect-journal.ts`
   - `apps/cloudflare/src/user-runner/runner-commit-recovery.ts`

5. Cloudflare also persists a gateway projection snapshot, even though gateway projections are rebuildable local state.
   - `packages/gateway-local/README.md`
   - `apps/cloudflare/src/gateway-store.ts`
   - `apps/cloudflare/src/execution-journal.ts`

## Target Architecture

### Hard requirement

Cloudflare becomes an execution shell over the same portable vault/runtime contract local Murph already uses.

### Allowed Cloudflare-native state

- Durable Object lease ownership
- alarm / wake scheduling metadata
- process and container supervision metadata
- optional ephemeral caches whose loss cannot affect correctness

### Forbidden long-term Cloudflare-native correctness state

- hosted-only committed-vs-finalized lifecycle truth
- hosted-only assistant-delivery recovery truth
- hosted-only second-phase bundle ownership
- hosted-only gateway projection correctness state

### Final run shape

1. Web fetches unseen wakes and passes one wake plus the current snapshot ref to Cloudflare.
2. Cloudflare restores the portable vault/runtime state exactly once.
3. `@murphai/assistant-runtime` runs the wake against the same vault/outbox model local Murph uses.
4. If the runtime reaches the committed snapshot boundary, Cloudflare persists only the minimum pending-commit recovery metadata in Durable Object state and resumes finalization from that same committed bundle when needed.
5. Once the final bundle exists, Cloudflare commits the final snapshot ref to web once and releases the lease.
6. Cleanup clears the pending-commit handoff and any transient ingress artifacts.

## Design Rules

1. If local Murph would not need a state record, hosted Cloudflare should not invent one.
2. If a hosted recovery concern is real, first try to encode it in the shared outbox/receipt/vault contract.
3. Rebuildable projections stay rebuildable.
   They may be cached, but they do not become commit truth.
4. A wake should have one web-visible durable completion boundary, even if Cloudflare temporarily holds a pre-CAS recovery handoff locally.

## Migration Workstreams

### Workstream 1: Make the portable outbox authoritative for hosted delivery recovery

Owner candidates:
- `packages/assistant-engine`
- `packages/assistant-runtime`
- `packages/runtime-state`

Changes:
- remove the Cloudflare-only assistant-delivery journal seam
- trust portable outbox mirror state directly for hosted delivery replay
- preserve the existing local Murph ambiguity rules for idempotent vs non-idempotent sends instead of carrying them in a second hosted store

Success criterion:
- hosted replay can resume assistant delivery from the portable assistant outbox/receipts state alone
- `side-effect-journal.ts` is no longer required for correctness

### Workstream 2: Replace execution-journal with DO-local pending-commit recovery

Owner candidates:
- `packages/assistant-engine`
- `packages/assistant-runtime`
- `packages/runtime-state`

Changes:
- keep recovery local to the Durable Object instead of a second R2 journal owner
- persist only the minimum pending-commit metadata required to resume from the committed bundle before the web cursor advances
- resume finalization from that pending-commit state on retry/restart
- commit the web cursor once with the final bundle ref

Success criterion:
- `execution-journal.ts` and `RunnerCommitRecovery` are gone
- `user-runner.ts` no longer needs a post-cursor finalize path or second cursor CAS

### Workstream 3: Collapse the post-cursor finalize path

Owner candidates:
- `packages/assistant-runtime`
- `apps/cloudflare`

Changes:
- make every successful cursor advance use the final bundle ref
- keep any resume-from-commit path strictly pre-cursor and local to the runner
- reduce post-cursor work to cleanup only

Success criterion:
- `finalizeWakeAfterCursorCommit(...)` disappears or becomes a no-op wrapper around cleanup
- there is no second cursor compare-and-swap after the initial commit

### Workstream 4: Demote gateway projection handling to cache or rebuildable projection

Owner candidates:
- `apps/cloudflare`
- `packages/gateway-local`

Current mismatch:
- gateway projection snapshots are being carried through the hosted execution journal even though gateway projections are documented as rebuildable local state

Options:
- delete hosted gateway projection persistence completely and rebuild when needed
- keep a best-effort cache in Cloudflare that is not tied to wake correctness

Success criterion:
- gateway projection state is not part of the hosted durable commit boundary

### Workstream 6: Remove bundle-slot cache if it no longer serves correctness

Owner candidates:
- `apps/cloudflare`

Current state:
- the old `runner_bundle_slots` table is already gone in the current checkout
- Cloudflare still keeps a single local bundle cache on `runner_meta` through `bundle_ref_json` and `bundle_version`

Evaluation rule:
- keep only if it materially improves restore latency without owning correctness
- delete if it exists primarily to support the intermediate commit/finalize path

Success criterion:
- the remaining `bundle_ref_json` / `bundle_version` state is either deleted or explicitly downgraded to a non-authoritative optimization

## Proposed Phase Order

### Phase 0: Proof and contract inventory

- document every hosted-only field currently carried by:
  - `HostedExecutionCommittedResult`
  - hosted side-effect journal records
  - bundle-slot cache rows
- map each field to one of:
  - shared vault/outbox contract
  - transport-only cache
  - dead weight

## New Baseline After Current Landed Work

The repo is now in a better intermediate state than when this plan was first drafted:

- `apps/web` active-member Linq ingress is already direct-wake-first
- `packages/assistant-runtime` prefers single-pass hosted completion
- `apps/cloudflare` prefers direct final bundle commits for the happy path

The remaining hosted-only correctness state is now narrower and easier to isolate:

- `execution-journal.ts`
- `runner-commit-recovery.ts`
- `side-effect-journal.ts`
- gateway projection persistence when used as commit truth
- any remaining `runner_bundle_slots` usage that is more than cache-only

That means the next implementation slices should focus on deleting the committed fallback stack itself rather than continuing to tune the already-landed happy path.

Deliverable:
- field-by-field keep/move/delete table

### Phase 1: Shared delivery continuity uplift

- fill any missing local outbox semantics needed for hosted replay
- add package-level tests proving hosted continuity from portable outbox state

Deliverable:
- portable assistant outbox is sufficient to resume hosted delivery

### Phase 2: Single-pass hosted runtime result

- change `assistant-runtime` to produce a final bundle in one run
- stop requiring hosted resume from a committed intermediate result

Deliverable:
- no `phase: "committed"` contract at the hosted runtime boundary

### Phase 3: Simplify Cloudflare runner around one commit

- remove finalize-after-cursor-commit flow
- remove second cursor compare-and-swap
- simplify wake processor and user runner

Deliverable:
- Cloudflare commits final snapshot refs to web once per wake

### Phase 4: Delete hosted-only journals and caches

- remove execution journal
- remove side-effect journal
- remove or demote bundle-slot cache
- demote gateway projection persistence to rebuild/cache behavior

Deliverable:
- Cloudflare owns only lease/schedule/supervision state

## Verification Plan

### Required proof before deleting hosted-only recovery

1. crash after restore, before any delivery
   Expected result: rerun from web cursor plus same vault snapshot is safe

2. crash after local outbox intent is persisted, before external send
   Expected result: portable outbox resumes delivery correctly

3. crash after external send may have succeeded, before local confirmation write
   Expected result: recovery uses the same confirmation-pending / idempotency semantics local Murph uses

4. crash after final bundle is stored, before cursor commit
   Expected result: replay is idempotent and does not require a hosted-only journal

5. crash after cursor commit
   Expected result: no second finalize phase is required to make the snapshot correct

### Minimum code-level tests to add or preserve

- `packages/assistant-runtime/test/**`
  - one-pass hosted final-result coverage
  - hosted replay from portable outbox state
- `packages/assistant-engine/test/**`
  - portable outbox confirmation-pending / retry / idempotency proofs
- `apps/cloudflare/test/**`
  - runner recovery without execution journal
  - single cursor commit flow
  - bundle cache deletion/demotion proofs

## Migration Risks

### Risk 1: Smuggling hosted-only semantics back into the shared outbox

Mitigation:
- only move semantics that local Murph would also need for a crash-safe delivery model

### Risk 2: Losing operational observability when journals disappear

Mitigation:
- keep diagnostics as mirrors or logs
- do not keep them as correctness truth

### Risk 3: Gateway projection rebuild cost increases

Mitigation:
- allow best-effort cacheing after correctness is removed from the path

### Risk 4: Hidden dependence on intermediate committed snapshots

Mitigation:
- prove all current consumers can tolerate one final snapshot-only model before deletion

## Explicit Non-Goals

- changing the web-owned wake/cursor model
- reintroducing any Cloudflare-owned canonical queue
- widening Cloudflare into a product-state owner
- keeping hosted-only recovery state just because it currently exists

## Recommended Next Steps

1. approve this target architecture explicitly
2. do Phase 0 as a code-backed field inventory before more implementation
3. land items 1 and 2 from the earlier audit independently
4. begin #3 with shared outbox continuity work, not with Cloudflare file deletion

The critical sequencing rule is: move correctness into the shared vault/outbox/runtime contract first, then delete Cloudflare-owned layers. Doing that in reverse would only reintroduce the same failure modes under different names.
