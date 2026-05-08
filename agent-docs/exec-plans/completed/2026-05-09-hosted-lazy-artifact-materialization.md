Goal (incl. success criteria):
- Reduce foreground hosted assistant reply latency by removing old raw/derived inbox and assistant-input artifact hydration from the mailbox visibility critical path.
- Preserve correctness for hosted mailbox watermarks, canonical write replay, assistant input replay, provider continuity, outbox/session state, and referenced attachment evidence.
- Land the simplest durable architecture:
  `restoreExecutionState()` -> mailbox import -> assistant admission -> targeted artifact materialization -> idle/full snapshot compaction.
- Success means foreground mailbox fetch/import and assistant reply-start can occur before any old `raw/**` or `derived/**` artifact GET, while current-message and restored-replay attachments still materialize when a known reader needs them.

Constraints/Assumptions:
- Do not expose local usernames, filesystem roots, mailbox payloads, prompts, transcripts, vault contents, signed URLs, native attachment ids, secrets, or provider payloads in logs, docs, test output, or fixtures.
- Keep restore before mailbox import. The change is to make restore narrower, not to reorder mailbox import ahead of execution-state restoration.
- Keep hosted canonical write receipt replay before mailbox import. Receipt replay is correctness state, not optional workspace content hydration.
- Do not move mailbox import into the Durable Object as part of this plan.
- Do not move mailbox cursor state to the database as part of this plan.
- Do not add a virtual filesystem, overlay workspace, generic artifact service, or broad platform port unless a later implementation proves the narrow materializer is insufficient.
- Treat idle shutdown as compaction. Do not make foreground correctness depend on materializing or compacting broad workspace content.
- Coordinate with active hosted inbox sidecar rebuild/bootstrap work before implementation because it touches the same runtime path and tests.

Key decisions:
- Name the architectural boundary as execution-state restore plus lazy exact artifact materialization, not a broad runtime/content split.
- Restore execution continuity eagerly:
  - `vault.json`
  - operator config metadata
  - hosted mailbox state files
  - assistant sessions, outbox, receipts, transcripts, state, indexes, automation state, cleanup state, cron scheduler state
  - assistant input events, accepted turn input journals, terminal evidence
  - live Codex continuity files referenced by session resume state, plus the continuity manifest
  - canonical write receipt logs, receipt artifacts, and payload refs
- Defer broad historical artifact roots:
  - `raw/inbox/**`
  - `raw/assistant-input/**`
  - `derived/inbox/**`
  - `derived/assistant-input/**`
- Materialize attachment evidence before assistant consumption only when restored input state references exact raw/derived paths needed for replay or prompt rendering.
- Use existing runtime-state artifact restore primitives. Extend them to report exact normalized paths actually restored instead of returning `void`.
- Track only successfully materialized paths, after restore/write/integrity validation.
- Feed materialized paths into idle/full snapshot creation so deleted materialized artifacts are not resurrected from preserved artifact refs.

State:
- Implemented and verified with focused runtime coverage.
- Five xhigh static review probes completed before implementation. No repo files were edited by those probes and no tests were run during review.

Done:
- Confirmed the current foreground shape still restores workspace before mailbox import.
- Confirmed canonical receipt replay currently runs before restore returns and should stay before mailbox import.
- Identified the eager restore filter as the primary latency seam: old `raw/inbox`, `raw/assistant-input`, `derived/inbox`, and `derived/assistant-input` artifacts are restored before mailbox import.
- Identified existing runtime-state support for filtered artifact materialization and snapshot `materializedArtifactPaths`.
- Identified the Cloudflare idle/full snapshot gap: full snapshot creation must receive materialized paths or lazy materialization can preserve stale artifact refs after deletion.
- Identified tests that currently encode the old behavior and should be inverted into latency/order assertions.
- Extended runtime-state restore helpers to report exact materialized `root:path` keys and to materialize targeted inline or externalized bundle files.
- Narrowed hosted foreground restore so broad historical raw/derived inbox and assistant-input content is skipped until exact readers request it.
- Threaded a restore-scoped materializer through hosted runtime, workspace runner, assistant execution context, prompt building, attachment evidence, and inbox attachment raw-ref materialization.
- Added snapshot-side materialized path tracking so deleted materialized lazy artifacts are not resurrected from preserved refs during idle/full snapshot compaction.
- Added focused tests for deferred foreground artifact fetch, targeted materializer missing/restored paths, corrupt targeted artifacts, and Cloudflare preserved-ref exclusion after materialization.

Now:
- Close and archive this plan.

Next:
- Root `pnpm test` remains blocked by an unrelated `packages/contracts` scheduled-log error-message assertion.
- Full `apps/cloudflare test:node` remains blocked by unrelated hosted deploy/bundle work already present in the checkout; focused bridge coverage for this plan passes.

Open questions (UNCONFIRMED if needed):
- Resolved: materialized path tracking is persisted in a small local assistant runtime state file that is excluded from hosted snapshots, then read by the Cloudflare bridge during idle/full snapshot creation.
- Resolved: assistant-engine receives the materializer through `AssistantExecutionContext.hosted`; engine code does not import hosted-runtime concepts.
- UNCONFIRMED: whether a narrow foreground correctness checkpoint should be restored before or after this plan. This is a separate risk from artifact hydration, but it affects crash/restart semantics for mailbox/outbox/terminal evidence.

Working set (files/ids/commands):
- `packages/assistant-runtime/src/hosted-runtime.ts`
- `packages/assistant-runtime/src/hosted-runtime/workspace-restore.ts`
- `packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts`
- `packages/assistant-runtime/src/hosted-runtime/artifacts.ts`
- `packages/assistant-runtime/src/hosted-runtime/models.ts`
- `packages/assistant-runtime/src/hosted-runtime/mailbox-conversation-import.ts`
- `packages/assistant-engine/src/assistant/attachment-evidence-model.ts`
- `packages/assistant-engine/src/assistant/inbox-attachment-evidence.ts`
- `packages/runtime-state/src/hosted-bundles.ts`
- `packages/runtime-state/src/hosted-bundle-node.ts`
- `apps/cloudflare/src/runtime-bridge-workspace.ts`
- `packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts`
- `packages/assistant-runtime/test/hosted-runtime-workspace-runner.test.ts`
- `packages/assistant-runtime/test/hosted-runtime-mailbox-conversation-import.test.ts`
- `packages/assistant-runtime/test/hosted-runtime-artifacts.test.ts`
- `packages/runtime-state/test/hosted-bundle.test.ts`
- `apps/cloudflare/test/runtime-bridge-workspace.test.ts`
- `apps/cloudflare/test/hosted-local-active-turn-latency-e2e.test.ts`
- `apps/cloudflare/test/hosted-local-snapshot-stress-e2e.test.ts`
- `apps/cloudflare/test/hosted-local-linq-webhook-e2e.test.ts`

## Architecture Plan

### 1. Preserve Ordering, Narrow Restore

Keep the foreground sequence:

```txt
workspace read
-> restore execution state
-> apply canonical write receipts
-> mailbox import
-> assistant phase
```

Change what restore means for hosted foreground runs. It should restore execution continuity and canonical correctness, not hydrate broad historical attachment/projection content.

The restore filter should no longer eagerly materialize old externalized artifacts under:

```txt
vault:raw/inbox/**
vault:raw/assistant-input/**
vault:derived/inbox/**
vault:derived/assistant-input/**
```

Inline files under the same broad content roots should follow the same policy unless they are exact referenced evidence needed for restored input replay.

### 2. Return Exact Materialization Results

Extend the runtime-state materializer shape from a `void` operation to an exact result:

```ts
type HostedArtifactMaterializationResult = {
  materializedArtifactPaths: ReadonlySet<string>;
  missingArtifactPaths: ReadonlySet<string>;
};
```

Only add a path to `materializedArtifactPaths` after:

- the path was present in a restored bundle/manifest;
- the external artifact was resolved;
- size/hash integrity passed;
- the file was written successfully.

Use normalized keys with a root prefix:

```txt
vault:raw/...
vault:derived/...
operator-home:.codex-hosted/...
```

Do not let callers infer success from requested paths. A missing path should not be tracked as materialized.

### 3. Thread A Restore-Scoped Materializer

Expose the narrow materializer from the hosted workspace restore result, then pass it through the existing hosted runtime path:

```txt
HostedWorkspaceRuntimeRestoreResult
-> runHostedWorkspaceRuntimeJobInProcess
-> runHostedWorkspaceUntilIdleOrBudget
-> assistant phase input/prep
```

Keep this out of `HostedRuntimePlatform`. It is restored workspace state, not a remote platform capability.

### 4. Materialize Only At Known Readers

Add targeted calls immediately before known reads of attachment evidence or derived content:

- restored assistant input attachment evidence;
- raw attachment copy/read paths;
- derived text/parser manifest reads;
- prompt rendering paths that read raw/derived evidence;
- mailbox projection/evidence paths only when they read artifact bytes.

Do not prewarm whole roots. Do not gate assistant reply-start on best-effort projection enrichment.

### 5. Track Materialized Paths Through Snapshotting

Maintain a workspace-scoped materialized path set. The set must survive long enough for idle/full snapshot creation to pass it into runtime-state snapshotting.

This prevents the known stale-ref failure mode:

```txt
1. old artifact ref is preserved from prior snapshot
2. foreground lazily materializes that path
3. assistant/user deletes or replaces the local file
4. idle snapshot does not know the path was materialized
5. compaction carries forward the old artifact ref and resurrects deleted content
```

The implementation must either persist this set as small assistant runtime state or bridge it into the Cloudflare snapshot context by another restart-safe mechanism.

### 6. Keep Projection Sidecar Policy Separate

The existing sidecar rebuild gating work is related but should not become this abstraction.

Long term:

- projection initialization should be idempotent and versioned;
- process-local readiness should be only a performance hint;
- projection rebuild should not block mailbox import or assistant admission unless exact evidence is required for restored input replay.

## Stress-Test Results

### Correctness Risks

- Deferring canonical receipts would break write idempotency and ordering. Do not defer them.
- Deferring exact artifacts referenced by restored accepted input can degrade replay/prompt correctness. Materialize exact referenced paths before assistant consumption.
- Tracking requested paths instead of restored paths can corrupt later snapshot preservation. Track successful writes only.
- Lazy materialization without snapshot `materializedArtifactPaths` can resurrect deleted artifacts.
- Silent evidence-read failures can hide materialization bugs because attachment evidence paths are currently tolerant. Add explicit tests and metadata-only diagnostics.

### Latency Risks

- Rebuilding or hydrating inbox sidecars before mailbox import can recreate the same latency shape under a different name.
- Broad root prewarming would preserve the complexity and latency of the old architecture.
- Moving mailbox import into the Durable Object would split import semantics across control plane and runtime and add rollback/idempotency complexity.
- Moving cursor state to the database first would not solve assistant latency if runtime still hydrates content before assistant admission.

### Operational Risks

- The active hosted runtime worktree already has overlapping sidecar, restore, deploy, provider-effect, and usage-gate changes. Do not layer implementation onto an unreviewed combined state.
- Foreground correctness currently leans heavily on idle-only checkpointing. That is adjacent but separate; treat idle as compaction, and evaluate a narrow runtime correctness checkpoint independently.
- CI/deploy logging and test fixtures must not print raw ids, local paths, signed URLs, provider payloads, prompts, or vault content.

## Acceptance Criteria

- Old externalized `raw/inbox`, `raw/assistant-input`, `derived/inbox`, and `derived/assistant-input` artifacts are not fetched before mailbox import or assistant reply-start unless exact restored input evidence requires them.
- Mailbox import still uses restored local mailbox state and advances watermarks only after item processing.
- Canonical write receipts are applied before mailbox import.
- Current-message attachments still produce bounded local evidence paths and prompt-visible evidence when needed.
- Restored accepted input with attachment evidence can still replay correctly.
- Missing/corrupt artifact materialization fails closed with sanitized metadata and does not mark paths as materialized.
- Idle/full snapshots preserve unmaterialized artifact refs but tombstone deleted materialized artifacts correctly.
- No new dependency cycle or hosted-runtime import into assistant-engine.

## Test Plan

### Assistant Runtime

- Rewrite the test that currently asserts raw/derived inbox artifacts restore before mailbox import so it asserts the opposite.
- Rewrite the many-artifact latency profile so mailbox fetch/import and reply-start happen before any old attachment artifact GET.
- Keep the stale pre-restore mailbox-read test and add an old externalized attachment case.
- Keep base/hot-state restore tests but assert pre-mailbox artifact GETs are limited to bundle, continuity, and canonical receipt/payload artifacts.
- Add a restored-input attachment replay test where exact referenced evidence paths materialize before assistant consumption.
- Extend the runner test that proves assistant reply-start does not wait for mailbox enrichment with a never-resolving best-effort materialization/enrichment effect.

### Runtime State

- Broaden the existing targeted materialization test to cover:
  - `raw/inbox`
  - `raw/assistant-input`
  - `derived/inbox`
  - `derived/assistant-input`
- Add integrity mismatch coverage for targeted materialization, not only eager restore.
- Preserve tests for carrying forward unmaterialized artifacts.
- Preserve tests for not resurrecting deleted materialized artifacts.

### Cloudflare Bridge

- Add foreground bridge coverage proving old externalized raw/derived artifacts are not downloaded before mailbox import/reply.
- Add idle/full snapshot coverage for a lazy-skipped artifact ref plus a deleted materialized artifact.
- Keep artifact route and lease isolation tests for targeted post-staging materialization.

### Hosted Local

- Extend active-turn latency with a fixture containing many old externalized artifacts and assert first reply before old artifact download/materialization markers.
- Extend snapshot-stress with many old externalized raw/derived artifacts and assert reply before idle/full checkpoint artifact hydration.
- Keep Linq webhook attachment correctness for voice/PDF current-message attachments and assert no signed URL, native attachment id, or local path leakage.

## Verification Commands

Run focused checks first:

```sh
pnpm --dir packages/runtime-state exec vitest run --config vitest.config.ts --no-coverage test/hosted-bundle.test.ts
pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --no-coverage test/hosted-runtime-workspace-entrypoint.test.ts test/hosted-runtime-workspace-runner.test.ts test/hosted-runtime-mailbox-conversation-import.test.ts test/hosted-runtime-artifacts.test.ts
pnpm --dir apps/cloudflare test:node
pnpm --dir apps/cloudflare test:workers
```

Run hosted-local focused scenarios after unit/integration checks:

```sh
pnpm hosted-local e2e linq-webhook
pnpm hosted-local e2e active-turn-latency
pnpm hosted-local e2e snapshot-stress
```

Run final gates before handoff:

```sh
pnpm typecheck
pnpm --dir packages/assistant-runtime test:coverage
pnpm --dir packages/runtime-state test:coverage
pnpm --dir apps/cloudflare verify
pnpm verify:acceptance
```
Status: completed
Updated: 2026-05-09
Completed: 2026-05-09
