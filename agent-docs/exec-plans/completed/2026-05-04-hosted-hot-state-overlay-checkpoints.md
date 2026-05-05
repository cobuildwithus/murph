# Hosted hot-state checkpoints

Status: completed
Created: 2026-05-04
Updated: 2026-05-05

## Goal

- Remove full workspace snapshot and raw artifact fanout from user-visible hosted assistant latency.
- Preserve the local assistant runtime as the owner of assistant semantics.
- Keep Cloudflare as a thin runtime host/storage provider.
- Add a cheaper durability primitive for correctness-critical local runtime state.
- Treat full workspace snapshots as cold/base restore images and lazy compaction outputs.

## Success criteria

- Hosted runtime can durably commit the existing hot-path checkpoint boundaries without uploading raw artifacts or the whole workspace.
- Current checkpoint semantics stay intact for the first behavior change. In particular, "import checkpoint succeeded" keeps its current meaning until a later projection-only optimization intentionally changes it.
- The hot paths satisfy:

```txt
externalArtifactPutCountBeforeAutomation = 0
externalArtifactPutCountBeforeFirstDelivery = 0
```

- Metrics distinguish broad artifact fanout from small bundle writes:

```txt
externalArtifactPutCount = raw/large artifact object writes
bundlePutCount = hosted bundle object writes
leaseCheckCount = lease/auth checks performed by object/bundle paths
```

- A hot checkpoint may still write one small bundle. That is acceptable if it stays bounded and avoids raw artifact fanout.
- Crash/restart recovery still preserves current safety properties for:
  - staged assistant input and mailbox watermarks
  - system mailbox processing
  - no-progress assistant runs
  - active-turn late input acceptance
  - outbox retry, sent, failure, and ambiguity state
- Full snapshots remain available for cold restore and compaction, but they do not block first automation or first provider delivery.

## Current problem

The hosted runtime effectively has one durability primitive today: a full hosted workspace checkpoint.

That primitive is used for many different commit boundaries:

- mailbox import and staged input durability
- best-effort projection checkpoints
- active-turn input refresh and acceptance
- outbox sending state before delivery
- delivery receipt/failure state after delivery
- maintenance and usage cleanup

In Cloudflare, a full checkpoint snapshots broad workspace roots, externalizes raw/large artifacts, writes those artifact objects, then writes the hosted bundle. Artifact writes also validate the active invocation lease through the user Durable Object path.

That makes small assistant-runtime commits behave like large workspace image commits.

The user-visible shape is:

```txt
new message arrived
-> mailbox import
-> full workspace snapshot
-> raw artifact PUT fanout and Durable Object lease checks
-> assistant starts
-> model returns quickly
-> outbox_sending full workspace snapshot
-> raw artifact PUT fanout and Durable Object lease checks
-> provider delivery starts
```

The model is not the bottleneck. The broad durability primitive sits on both sides of the model.

## Core reframing

Use separate durability roles:

```txt
Web mailbox = durable ingress log
Local assistant runtime files = semantic source of truth
Full snapshot ref = cold/base runtime image
Hot-state ref = latest authoritative assistant-runtime continuity image
Cloudflare = thin host plus storage/lease/platform ports
```

The target is not to remove durability. The target is to make hot-path durability proportional to the state being committed.

## Proposed architecture

### Snapshot ref contract

Keep support for the existing single full snapshot ref. Add one layered shape with a base full snapshot and one latest authoritative hot-state ref.

Do not build an ordered overlay chain first.

Illustrative contract:

```ts
type HostedWorkspaceSnapshotRef =
  | HostedExecutionBundleRefState
  | {
      schema: "murph.hosted-execution-layered-snapshot.v1";
      base: HostedExecutionBundleRefState | null;
      hot: HostedExecutionBundleRefState | null;
    };
```

Roles:

```txt
base = broad encrypted runtime image for cold restore/compaction
hot = complete latest encrypted assistant-runtime continuity subset
```

Restore:

```txt
create empty local roots
restore base full snapshot, if present
clear authoritative hot-state paths
restore latest hot-state bundle, if present
```

Hot checkpoint:

```txt
snapshot the complete hot-state subset
write one small hot bundle
CAS update HostedWorkspace.snapshotRef = { base: currentBaseRef, hot: newHotRef }
do not append a chain
```

If there is no current base snapshot, fail closed to a full/base checkpoint until
the cold restore image exists. Hot-only `base: null` remains a valid contract
shape for parsing/restore, but the first behavior-preserving rollout should not
drop non-hot workspace content just to avoid one initial full snapshot.
The same fail-closed fallback applies when the current browser-vault replica is
missing or does not match the current base snapshot hash, because a hot checkpoint
must carry forward dashboard continuity explicitly without regenerating a
browser-vault sidecar on the hot path.

Full compaction:

```txt
restore base + hot
write new full snapshot
CAS update HostedWorkspace.snapshotRef = newFullRef
```

This keeps one `HostedWorkspace` CAS row and avoids a new DB model. It also avoids overlay ordering, overlay count thresholds, tombstones, stale-overlay cleanup complexity, and restore ambiguity.

### Deletion invariant

A hot-state ref is authoritative for its include roots. It must represent the complete current hot subset, not a diff.

Before restoring `hot`, clear only the hot-state include roots/subtrees. Then restore the hot bundle.

This prevents stale files from the base snapshot from resurrecting.

Important crash test:

```txt
base snapshot contains outbox intent A
hot checkpoint terminalizes or removes A
restore base + hot
A must not resurrect
```

Clearing hot roots is simpler than tombstones and safer than ordered patch overlays.

### Hot-state snapshot

Add a `snapshotHostedAssistantRuntimeHotState` style primitive that snapshots only the local files required for future side effects or assistant continuity.

The include list must be explicit. Do not define hot state as "all assistant runtime minus a denylist." That risks growing into another full snapshot.

Initial include policy:

```txt
vault/.runtime/operations/assistant/** correctness state:
  assistant input events
  accepted-turn journals
  active-turn admission state
  sessions and bindings needed for reply continuity
  turn receipts/state needed for recovery
  outbox intents and delivery mirror state
  system mailbox pending/receipt state
  provider cleanup/recovery state if it changes future sends or retries
```

Initial exclude policy:

```txt
diagnostics unless the runtime reads them for correctness
status snapshots unless they gate retry/recovery behavior
cron run logs unless they gate execution
vault/raw/**
vault/derived/**
vault/.runtime/projections/**
vault/.runtime/cache/**
vault/.runtime/tmp/**
operator home
Codex home
inbox materialized attachments
parser outputs
locks, sockets, pid files
secrets, quarantine payloads, repair bins
```

Hot state should be small by construction. Add hard budgets:

```txt
hotStateMaxFiles
hotStateMaxInlineBytes
hotStateMaxBundleBytes
```

If the hot snapshot exceeds budget, fail closed to a full checkpoint for production safety or fail loudly in non-production. Do not let hot state silently become full snapshot v2.

## Checkpoint policy

First implementation: keep existing checkpoint boundaries and change only snapshot policy by reason.

| Boundary | Initial policy | Blocks user-visible path? | Reason |
| --- | --- | ---: | --- |
| Mailbox import | hot when a base exists; full fallback otherwise | yes, tiny after base exists | Preserves current import/watermark semantics while removing broad artifact fanout for established workspaces. |
| System mailbox import/receipt | hot | yes, tiny | System mailbox rows may drive effects and need a local durability fence. |
| Active-turn input refresh | hot | yes, tiny | Late input keeps current pending-vs-accepted semantics. |
| Active-turn acceptance | hot | yes, tiny | Accepted input survives continuation/restart. |
| Assistant generated outbox/no-reply decision | hot | yes, tiny | Local assistant decision becomes durable without full artifact fanout. |
| Outbox sending before provider delivery | hot | yes, tiny | Pre-send durability fence for retry/ambiguity/idempotency behavior. |
| Delivery receipt/failure | hot | no or very short | Sent/retry/failure state becomes durable. |
| Projection/enrichment | none or best-effort hot | no | Projection should not block assistant admission or delivery. |
| Idle/budget/error checkpoint | hot unless broad workspace changed | no or very short | Preserve local continuity cheaply where possible. |
| Maintenance/usage cleanup | full or hot depending on changed state | no | Broad workspace changes can use off-path full snapshot. |
| Compaction | full | no | Refreshes the cold/base runtime image. |

The first target is:

```txt
current semantics
+ same checkpoint boundaries
+ hot snapshot policy for hot reasons
+ zero raw artifact PUTs before automation and first delivery
```

Projection-only conversation import should be a later optimization, not a dependency for the first correctness-preserving latency fix.

## Why not web-owned delivery intent

Web-owned delivery intent would move assistant/outbox semantics out of the local assistant runtime and into the hosted control plane.

That conflicts with the thin-runner architecture:

- `apps/web` owns mailbox, product/control facts, workspace checkpoint metadata, and redacted status/logs.
- `apps/cloudflare` owns execution hosting, object plumbing, Durable Object coordination, and platform ports.
- `packages/assistant-runtime` and `packages/assistant-engine` own assistant input, outbox, receipts, active-turn state, retry policy, and runtime decisions.

Hot-state checkpoints preserve that split. They make local runtime durability cheaper without changing semantic ownership.

## Why not projection-only import first

Projection-only import is useful, but it changes semantics.

It would make mailbox import replayable before a durable assistant decision. That may be the right end-state for conversation rows, but it forces a lag/status/replay rewrite at the same time as the snapshot refactor.

It also does not solve the full user latency problem by itself. Current delivery is checkpoint-gated after model output. If `outbox_sending` remains a full snapshot, then raw artifact fanout still happens after the model returns and before the user receives the message.

The lower-risk path is:

```txt
first: make current checkpoints cheap
then: consider making clearly replay-safe conversation import projection-only
```

## Phased implementation

### PR 1: instrumentation only

No semantic changes.

Add redacted counters and timings around checkpoint creation, object writes, lease checks, and hot-path milestones.

Required metrics:

```txt
checkpointPolicy: none | hot | full
checkpointReason
snapshotMode: none | hot-state | full
snapshotElapsedMs
snapshotInlineBytes
snapshotFileCount
externalArtifactPutCount
externalArtifactPutBytes
bundlePutCount
bundlePutBytes
leaseCheckCount
externalArtifactPutCountBeforeAutomation
externalArtifactPutCountBeforeFirstDelivery
bundlePutCountBeforeAutomation
bundlePutCountBeforeFirstDelivery
mailboxAppendToAutomationStartMs
modelReturnToFirstDeliveryStartMs
modelReturnToFirstDeliverySentMs
deliverySentToFullCompactionDoneMs
hotStateFileCount
hotStateInlineBytes
hotStateBundleBytes
```

Implementation notes:

- Emit checkpoint metrics from the Cloudflare checkpoint snapshot path.
- Include checkpoint reason from the runtime request builder.
- Count lease checks in the outbound object/bundle routes.
- Keep logs metadata-only. Do not include message text, raw provider payloads, local paths, filenames, contact identifiers, secrets, prompts, or full authorization headers.

Acceptance:

- Existing behavior remains unchanged.
- Local baseline can report artifact, bundle, and lease counts by reason.
- Production logs can distinguish `import`, `outbox_sending`, `outbox_receipt`, and `maintenance`.
- Baseline e2e can seed 100 artifacts and 300 assistant messages and report pre-automation and pre-delivery fanout.

### PR 2: base plus latest-hot snapshot contract

Add layered snapshot parsing and restore support without changing checkpoint policy.

Tasks:

1. Add the `{ base, hot }` snapshot ref contract in the hosted execution/runtime-state owner surface.
2. Keep existing single-bundle refs supported as the common case.
3. Teach restore to:
   - create empty roots
   - restore base
   - clear hot-state paths
   - restore hot
4. Add strict parsing so malformed refs fail closed.
5. Add tests for:
   - restoring a single bundle ref
   - restoring `{ base, hot: null }`
   - restoring `{ base, hot }`
   - hot overwrite wins over base
   - hot deletion works by clearing hot paths before restore
   - malformed refs fail closed

Acceptance:

- Existing full snapshot checkpoints still work.
- No hot path behavior changes yet.
- Layered refs do not expose plaintext paths or sensitive metadata in logs.

### PR 3: hot-state snapshot primitive

Add a hot-state snapshot primitive that produces one complete hot bundle from the explicit include list.

Tasks:

1. Define the hot-state include/exclude policy in code and docs.
2. Snapshot only selected assistant runtime files.
3. Write one small encrypted bundle through the existing hosted bundle store.
4. CAS update `HostedWorkspace.snapshotRef.hot = newHotRef`.
5. Add hot-state size budgets and fail-closed behavior.
6. Add focused tests with seeded raw artifacts proving:
   - hot checkpoint writes no external raw artifact objects
   - hot checkpoint does not traverse or include `raw/**`
   - hot checkpoint does not include diagnostics/status/log files unless they are explicitly correctness-gating
   - hot restore preserves input/session/outbox/system mailbox state over the base
   - hot deletion semantics prevent stale base files from resurrecting
   - full snapshot restore remains unchanged

Acceptance:

- `externalArtifactPutCount = 0` for hot checkpoints.
- `bundlePutCount = 1` is acceptable for hot checkpoints.
- Hot bundle size and file count stay within configured bounds.
- Full snapshot behavior remains available.

### PR 4: switch hot-path checkpoints to hot snapshots

Keep existing checkpoint boundaries. Change policy by reason.

Initial policy:

```txt
import: hot
active_turn_input: hot
active_turn_acceptance: hot
assistant_decision/outbox_intent: hot
outbox_sending: hot
outbox_receipt: hot
system_mailbox_sending: hot
system_mailbox_receipt: full
idle/budget/error: hot unless broad workspace state changed
maintenance: full only off the user-visible path
```

`system_mailbox_receipt` stays full in the first rollout because activation can
mutate canonical vault bootstrap state. Keeping that boundary full preserves the
existing guarantee that later conversation wakes restore the bootstrapped local
runtime instead of restoring only a hot assistant overlay.

Tasks:

1. Add checkpoint policy selection by reason.
2. Preserve current rollback/fail-closed semantics where a hot checkpoint is the durability fence.
3. Move provider delivery to run after hot checkpoint, not after full snapshot.
4. Preserve current delivery retry/ambiguity behavior for non-idempotent transports.
5. Add crash-window tests around each checkpoint boundary.

Crash tests:

| Crash window | Expected behavior |
| --- | --- |
| Before mailbox import checkpoint commits | Mailbox replays; no side effect happened. |
| After hot import checkpoint, before model output | Restore keeps imported/staged state according to current semantics. |
| After system mailbox import, before execution | Hot restore keeps pending system mailbox state. |
| After model output, before hot outbox checkpoint | Reply/outbox decision may be lost; no user-visible side effect happened. |
| After hot `outbox_sending`, before send | Restore sends/resumes the outbox intent. |
| After send, before receipt checkpoint | Restore sees sending state; idempotent transports retry/reconcile; non-idempotent transports retain ambiguity/confirmation-pending behavior. |
| After receipt checkpoint | Restore sees sent/failed/retry state; no duplicate send. |

Acceptance:

- `externalArtifactPutCountBeforeAutomation = 0`
- `externalArtifactPutCountBeforeFirstDelivery = 0`
- `bundlePutCountBeforeAutomation` and `bundlePutCountBeforeFirstDelivery` are measured and bounded.
- Current delivery safety tests still pass or are replaced by stronger crash tests.

### PR 5: full compaction

Add off-path full snapshot compaction.

With one latest hot ref, compaction is simple:

```txt
if hot exists and budget remains:
  restore base + hot
  write full snapshot
  CAS snapshotRef = newFullRef
```

Possible compaction triggers:

```txt
hotStateBundleBytes > M
hotStateFileCount > N
hotAge > T
base full snapshot missing
maintenance wake
runner budget available after user-visible work
```

Tasks:

1. Restore current base plus hot.
2. Write a full snapshot.
3. CAS update `snapshotRef` to the new full snapshot.
4. Best-effort delete unreferenced hot/full artifacts only after the CAS succeeds and retention policy allows it.

Acceptance:

- Full snapshot artifact fanout occurs off the user-visible path.
- Failed compaction leaves the existing base plus hot ref restorable.
- Restore does not require walking an overlay chain.

### PR 6: optional projection-only conversation import

Only add this after hot checkpoints prove stable and if hot import remains too slow.

Rules:

- Conversation mailbox rows can be projected without checkpoint only before model/output side effects.
- System mailbox rows require durable checkpointing before execution; activation receipt remains full until canonical bootstrap mutation is split from receipt durability.
- Mixed-lane import should default to hot checkpoint unless lane-specific sequencing proves a safe split.
- Lag/status must distinguish append, projected, accepted/decisioned, terminal, and snapshotted/compacted states.

Acceptance:

- Conversation-only inbound message can start automation without any checkpoint.
- System mailbox behavior remains durable.
- Lag sweeper does not hide work or generate unsafe duplicate nudges.

## Code surfaces

Likely primary surfaces:

- `packages/hosted-execution/src/runtime-control.ts`
- `packages/hosted-execution/src/parsers/runtime-control.ts`
- `packages/runtime-state/src/hosted-bundles.ts`
- `packages/runtime-state/src/hosted-bundle-node.ts`
- `packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts`
- `packages/assistant-runtime/src/hosted-runtime/mailbox-checkpoint.ts`
- `packages/assistant-runtime/src/hosted-runtime/mailbox-conversation-import.ts`
- `packages/assistant-runtime/src/hosted-runtime/system-mailbox.ts`
- `packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts`
- `packages/assistant-runtime/src/hosted-runtime/callbacks.ts`
- `apps/cloudflare/src/runtime-bridge-workspace.ts`
- `apps/cloudflare/src/runtime-bridge-checkpoint.ts`
- `apps/cloudflare/src/runtime-platform.ts`
- `apps/cloudflare/src/runner-outbound.ts`
- `apps/web/src/lib/hosted-mailbox/lag.ts`
- `apps/web/src/lib/hosted-mailbox/lag-sweeper.ts`
- `apps/web/app/api/internal/hosted-runtime/status/route.ts`

Likely test surfaces:

- `packages/assistant-runtime/test/hosted-runtime-workspace-runner.test.ts`
- `packages/assistant-runtime/test/hosted-runtime-workspace-assistant-phase.test.ts`
- `packages/assistant-runtime/test/hosted-runtime-mailbox-conversation-import.test.ts`
- `packages/hosted-execution/test/hosted-runtime-control.test.ts`
- `packages/runtime-state/test/**`
- `apps/cloudflare/test/hosted-runtime-checkpoint-baseline-e2e.test.ts`
- `apps/cloudflare/test/runner-outbound.test.ts`
- `apps/cloudflare/test/runner-platform.test.ts`
- `apps/web/test/hosted-runtime-internal-routes.test.ts`
- `apps/web/test/hosted-mailbox-lag-sweeper.test.ts`

Docs to update with behavior changes:

- `ARCHITECTURE.md`
- `agent-docs/references/hosted-runtime-protocol.md`
- `packages/assistant-runtime/README.md`
- `apps/cloudflare/README.md`

## Test plan

Focused correctness tests:

- single full snapshot restore still works
- `{ base, hot }` restore applies hot after base
- hot overwrite wins over base
- hot deletion semantics prevent stale base files from resurrecting
- hot import checkpoint commits mailbox state without raw artifact PUTs
- system mailbox import restores before execution
- no-progress assistant run does not replay forever
- assistant failure after import can recover from hot state
- active-turn late input restore preserves pending-vs-accepted state
- outbox intent hot checkpoint restores before send
- crash after send but before receipt checkpoint preserves idempotent retry or non-idempotent ambiguity
- receipt checkpoint prevents duplicate send
- full compaction preserves final state and clears the hot ref into a new full snapshot

Performance/baseline tests:

- Seed a hosted workspace with 100 raw artifacts and 300 assistant messages.
- Measure current full checkpoint behavior:
  - external artifact PUT count
  - external artifact bytes
  - bundle PUT count/bytes
  - lease check count
  - mailbox append to automation start
  - model return to first delivery start/sent
- Measure hot checkpoint behavior:
  - `externalArtifactPutCount = 0`
  - `bundlePutCount = 1`
  - hot bundle bytes stay bounded
  - pre-automation external artifact PUT count is zero
  - pre-delivery external artifact PUT count is zero

Status/lag tests:

- In PRs 1-5, current lag semantics should remain unchanged unless a test proves the hot ref cannot preserve them.
- If PR 6 adds projection-only import, lag/status must distinguish at least:
  - appended high-water
  - projected in current invocation
  - imported/restorable
  - accepted/decisioned
  - terminal handled
  - snapshotted/compacted
- Lag sweeper must not suppress nudges based only on a non-restorable projection.

## Risks and mitigations

1. Risk: Hot-state include list misses a file needed for recovery.
   Mitigation: start with explicit correctness state, add crash tests for each commit boundary, and fail closed to full checkpoint for unknown reasons.

2. Risk: Hot-state include list grows until it resembles a full snapshot.
   Mitigation: keep an explicit allowlist, track hot file count/bytes, and enforce budgets.

3. Risk: Deleted or terminal local state resurrects from the base snapshot.
   Mitigation: clear hot-state paths before restoring `hot`; test deletion semantics directly.

4. Risk: Hot checkpoint still has too much lease/object overhead.
   Mitigation: separate external artifact PUTs from bundle PUTs and lease checks in metrics; optimize the bounded bundle path after removing raw artifact fanout.

5. Risk: Delivery-before-full-snapshot duplicates messages.
   Mitigation: keep hot `outbox_sending` as the pre-send durability fence, preserve idempotency keys for idempotent transports, and keep existing ambiguity behavior for non-idempotent transports.

6. Risk: Logs leak sensitive runtime state.
   Mitigation: metrics only. No raw payloads, message text, filenames, local paths, prompts, secrets, contact identifiers, or full auth headers.

## Open questions

- Should hot refs use ordinary hosted execution bundle objects or a distinct object kind with separate retention/cleanup policy?
- What initial hot-state file/byte budgets should fail closed to full checkpoint?
- Which diagnostics/status files, if any, are read by runtime retry/recovery logic and must be included for correctness?
- Should full compaction happen inside the same invocation after send when budget remains, or always schedule a maintenance wake?
- After hot checkpoints are stable, is projection-only conversation import still worth the extra lag/replay semantics?

## Verification

For this planning-only Markdown change:

- Read back this plan and the coordination ledger row.
- Run Markdown/diff hygiene checks.
- No repo-wide test or typecheck is required by the text-only docs/process fast path.

For implementation PRs:

- Use `pnpm test:diff <touched paths>` when it truthfully covers the touched surfaces.
- For broad runtime/checkpoint changes, expect package/app focused tests plus `pnpm typecheck`.
- For cross-cutting snapshot/restore behavior, run the relevant `packages/runtime-state`, `packages/assistant-runtime`, `packages/hosted-execution`, and `apps/cloudflare` focused lanes.

## Closure

- Related hot-state checkpoint code landed in prior commits, including `fix(hosted-runtime): add hot-state checkpoints`.
- User accepted closing the plan on 2026-05-05.
Completed: 2026-05-05
