# Hosted Shutdown Checkpoint Handoff

Status: completed
Updated: 2026-07-10

## Why

Container rollout shutdown exposed an avoidable two-snapshot path. A valid
`idle_shutdown` snapshot could finish uploading after fresh conversation input
was appended. Web then rejected the already-uploaded snapshot with
`foreground_pending`; the shutting-down runtime copied wake metadata into local
state and built essentially the same snapshot again. The two large archive and
upload passes, plus the existing Temporal owner-recheck wait, turned a warm
reply into a roughly minute-long reply.

The bug is a conflation of two independent facts:

- whether a snapshot is a valid next prefix of workspace history; and
- whether newer durable conversation input exists after that prefix.

A newer mailbox row does not invalidate an otherwise valid snapshot. Mailbox
lag is already durable web-owned recovery truth, so snapshot acceptance must not
try to encode or consume that wake.

## Goal

Accept every valid workspace-version-CAS checkpoint exactly once, commit its
requested wake projection with the same prefix, and let mailbox lag drive
follow-up work.
After an execution owner is cleared, promptly interrupt Temporal's existing
owner-recheck wait through the existing payload-free recheck signal.

Success means:

- a late conversation append cannot force a second metadata-only shutdown
  snapshot;
- old Web still triggers the complete existing runtime retry behavior;
- a live default-mode runtime can immediately import conversation input
  discovered during checkpoint publication;
- a shutting-down runtime leaves that input to the durable mailbox/Temporal
  path without losing or overwriting its wake;
- input already staged before a shutdown yield remains runnable after restore
  through a due assistant wake on its ordinary dirty checkpoint;
- Cloudflare clears a fence only after positive inactive or mismatch proof, or
  exact completion;
- no new queue, alarm, scheduler, workflow command, or durable coordination
  state is introduced.

## Architecture

### 1. Checkpoint validity is only workspace-prefix validity

Inside the existing Web checkpoint transaction:

1. lock and validate the expected workspace version;
2. compare the durable conversation mailbox head with the checkpoint's imported
   conversation sequence;
3. commit the valid snapshot and redacted status regardless of that comparison;
4. return `conversationInputAhead: true` when durable conversation input is
   newer than the committed prefix;
5. commit the request wake projection as part of the same CAS-authoritative
   snapshot/redacted-watermark prefix.

The field name is intentionally not a conflict or failure name. It is a
transient observation taken under the same locks as the successful checkpoint.
No new persisted flag is needed because every later checkpoint/reconciliation
read can derive the fact from mailbox and workspace truth.

### 2. Runtime consumes the observation without a carry state machine

The shared checkpoint parser accepts the optional observation. A new runtime:

- imports foreground conversation input immediately when default-mode work
  remains live; or
- returns from retention-only work or shutdown and leaves the durable lag to
  Web/Temporal.

The runtime removes post-upload wake checks that currently discard a paid-for
snapshot. Real local mutations or pending durable effects still require their
normal follow-up checkpoint. Only the metadata-only shutdown resnapshot is
deleted. When a shutdown-time import has already staged assistant input, the
ordinary dirty checkpoint carries a due `assistant` wake; otherwise the
advanced imported watermark could hide that staged work from mailbox-lag
reconciliation after restore.

Mixed-version compatibility stays explicit: when old Web returns the existing
`foreground_pending` conflict, the runtime runs the full current fallback,
including the second checkpoint. That compatibility path can be deleted only
after production proves no old Web deployment can answer the callback.

### 3. Owner release wakes existing orchestration

After UserRunner proves exact invocation completion and clears the matching
write fence, Cloudflare sends at most one authenticated, best-effort callback to
Web.
The call has a short explicit timeout, no body, and no retry. It accepts either
no query or one exact signature-bound positive
`immediateRecheckRequested=1` query. Without that edge, Web derives
actionability from current workspace/mailbox truth and uses the existing
payload-free `runtime_recheck_requested` signal only for visible runnable
mailbox lag. Persisted due default and retention wakes are not level-triggered
signal authority.

The runtime emits the positive edge only when this invocation produced a
default or retention schedule, committed it, and did not service it. An
invocation-local set of exact `(at, normalized reason)` keys preserves multiple
or masked durable continuations: presenting a key removes it, while a same-key
continuation adds it again. No edge is persisted. Known future mailbox retry
continuations suppress the edge and preserve their retry time; future
assistant, device, and retention schedules may use it so Temporal immediately
re-reads facts and owns the exact timer. Cloudflare skips an ordinary callback
for known future mailbox retry continuations. There is no new Temporal signal
kind or command ordering change.

The callback happens after the identity-checked storage transition and outside
any storage transaction or concurrency lock. Failure is observable but cannot
make completed runtime work fail or recreate the cleared owner.

### 4. Ambiguous liveness preserves ownership

Only a positive `inactive` or `mismatch` probe, or exact completion, may clear
the active fence. `unsupported`, timeout, error, and other indeterminate probe
outcomes preserve it. This closes the deploy-skew path where a still-running
old child could continue publishing after its fence was prematurely cleared.

## Deletion Ledger

- Delete the Web `foreground_pending` branch for new checkpoint publications.
- Delete the runtime's post-upload wake rejection checks.
- Delete the metadata-only shutdown wake handoff/resnapshot path.
- Retain the old-Web conflict handler temporarily and visibly as rollout
  compatibility. Its future deletion must remove the `foreground_pending`
  reason from the shared conflict contract, the runner-outbound pass-through,
  `assertIdleShutdownCheckpointAccepted`, the shutdown conflict catch, and the
  checkpoint-conflict constructor branch without deleting the pre-snapshot
  wake-interrupt error class.
- Add no database model, migration, Durable Object table/column, alarm, queue,
  Temporal workflow state, or retry manager.

## Failure Modes

| Failure | Required behavior |
| --- | --- |
| Mailbox append races snapshot upload | Commit the valid snapshot and return `conversationInputAhead`. |
| Old Web rejects with `foreground_pending` | Run the complete legacy retry path; do not assume a commit. |
| New field omitted by old Web | Treat as false; existing behavior remains valid. |
| Runtime shuts down after successful checkpoint | Do not resnapshot; durable mailbox lag remains recovery truth. |
| Runtime imports and stages conversation input before the shutdown yield | Checkpoint the real dirty state with a due assistant wake so restore can run the staged input. |
| Shutdown sees only a bare wake, no-work import, or durably consumed replay | Do not manufacture an assistant wake or metadata-only checkpoint. |
| Default-mode runtime remains live after successful checkpoint | Import through the existing conversation path without inventing a local wake. |
| Retention-only runtime observes conversation input ahead | Preserve lane separation and let the post-fence recheck dispatch default-mode work. |
| Runtime response is lost after committing an advanced prefix with mailbox lag | On explicit inactive proof, recover from the advanced workspace version, clear the exact fence, and recheck the remaining lag. |
| Owner-release callback times out or fails | Log bounded metadata and return successful completion; Temporal's owner horizon remains the backstop. |
| Callback is duplicated | Existing Temporal signal coalescing makes it harmless. |
| An inherited due wake makes no progress | Preserve the durable wake but omit the positive edge so owner release cannot hot-loop. |
| A pass produces another continuation with the same wake key | Remove the presented key, then add the produced continuation so exactly one successor is requested. |
| A future mailbox retry is not yet due | Omit the edge and callback; keep the retry timestamp authoritative. |
| A durable effect is held behind an earlier due wake | Track both exact wake keys until the earlier wake is presented and the durable wake is committed. |
| Liveness is unsupported/timeout/error | Preserve the fence and retry through existing owner reconciliation. |
| A durable effect stages a wake while conversation input remains ahead | Commit the request wake with the same CAS prefix; never splice in an older wake pair. |

## Verification

- Shared contract/parser coverage for absent and true
  `conversationInputAhead` and `immediateRecheckRequested`, plus the shared
  future-mailbox continuation classifier.
- Web transaction coverage proving snapshot commit, mailbox-ahead observation,
  CAS precedence, and request wake preservation under a late append.
- Runtime coverage proving one snapshot on new Web, full two-snapshot fallback
  on old Web, immediate live import, staged-input assistant wakes, no-work and
  consumed-replay suppression, sticky-wake no-loop behavior, same-key and
  masked durable continuations, and real-dirty/effect follow-up snapshots.
- Cloudflare coverage proving callback order, one attempt, short timeout,
  non-fatal failure, and conservative unsupported liveness.
- Web callback auth and payload-free Temporal recheck coverage.
- Direct hosted-local shutdown/checkpoint regression scenario when the existing
  harness can exercise the race truthfully.
- Required security/privacy and coverage-write audits, parent final review,
  truthful `pnpm test:diff` for all touched paths, and full acceptance.
- Draft PR ReviewGPT rounds until the final pushed head has zero accepted
  findings, plus final CI and merge-conflict proof.

## Deployment

The contract is additive and tolerant in both directions:

- New runtime + old Web: the retained `foreground_pending` fallback preserves
  old behavior.
- Old runtime + new Web: the unknown success field is ignored; durable mailbox
  lag still recovers the input, although schedule edges fall back to the owner
  horizon until the producer converges.
- New Cloudflare + old Web: the owner-release callback may return 404 and is
  non-fatal; the existing owner horizon remains the backstop.

Recommended production order is Cloudflare/runner first, then Web. Use
`container_rollout=immediate` so the latency fix converges promptly and verify
new runner fingerprint/smoke before changing Web checkpoint semantics. After
Web deploy, confirm one late-input checkpoint commits once, the exact fence is
cleared, and the owner-release recheck is accepted. Rollback order is Web first,
then Cloudflare/runner.

## Working Set

- `packages/hosted-execution/src/runtime-control.ts`
- `packages/hosted-execution/src/parsers/runtime-control.ts`
- `packages/hosted-execution/test/hosted-runtime-control.test.ts`
- `apps/web/src/lib/hosted-workspace/store.ts`
- `apps/web/app/api/internal/hosted-workspace/checkpoint/route.ts`
- new narrow signed owner-release callback route and focused Web tests
- `packages/assistant-runtime/src/hosted-runtime.ts`
- `packages/assistant-runtime/src/hosted-runtime/snapshot-bridge.ts`
- matching assistant-runtime tests
- `apps/cloudflare/src/web-control-plane.ts`
- `apps/cloudflare/src/user-runner/runtime-invocation.ts`
- `apps/cloudflare/src/user-runner/runtime-fence-liveness.ts`
- matching Cloudflare tests
- `ARCHITECTURE.md`
- `agent-docs/SECURITY.md`
- `agent-docs/references/hosted-runtime-protocol.md`
- app/package README updates required by the changed trust boundary
Completed: 2026-07-10
