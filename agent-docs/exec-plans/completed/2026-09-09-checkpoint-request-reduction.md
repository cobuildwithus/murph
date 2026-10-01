# Reduce redundant hosted checkpoint work

Status: completed
Created: 2026-09-09
Updated: 2026-09-09

## Outcome and protected invariants

Reduce redundant background control-plane requests and derived-view work while preserving canonical writes, workspace compare-and-swap, snapshot cleanup after ambiguous responses, explicit Browser Vault repair, and durable scheduling/recovery. Do not add caches, services, queues, or state owners. Request savings must be reported per proven operation; traffic-volume changes are not causal proof.

## Existing owners and evidence

The runtime forces Browser Vault publication for ordinary system mailbox work despite an existing source-freshness check. Snapshot completion rereads the Web workspace to remember the replaced blob although the snapshot bridge already has the prior reference. The checkpoint route signals scheduler rechecks for unchanged wake projections. Each candidate is implemented only if its existing owner can preserve failure and rollout contracts with a smaller flow.

## Scope and decisions

- Use the existing Browser Vault freshness resolver for ordinary background work; retain explicit forced repair.
- Carry the known prior snapshot reference through the existing upload session and preserve pre-CAS cleanup obligations and warm-old callers.
- Deferred scheduler-signal suppression: an identical later checkpoint currently retries a failed signal. Removing it can hide nearer work until the existing accepted-owner horizon (230 seconds at defaults), and complete projection comparison also spans retry and conversation-import facts. No new delivery state or projection abstraction is justified for this optimization.
- Preserve pre-provider retry publication and the two-checkpoint system completion protocol; their deletion lacks sufficient recovery proof.
- Root owns integration, docs, plan, review, and merge. Delegated file ownership separates runtime Browser Vault, Cloudflare snapshot transport, and Web checkpoint scheduling.

## Product UX

- Effort: Patch.
- Outcome: Background work performs less repeated I/O with the same member-visible data and recovery promises.
- Reaches: Unchanged and changed canonical sources, explicit unreadable-replica repair, stale replicas, snapshot retries/cold restore, and scheduling changes while a runtime owns work.
- Proof: Focused composed runtime/publication tests, upload lifecycle/cleanup tests, Web checkpoint scheduling tests, and existing fallback-owner evidence. No prompt, tool, message, UI, or provider-input changes.
- Result: Ready. Composed tests cover each freshness case, explicit repair, preemption, mailbox completion, and cold-restore continuation; member-facing semantics are unchanged.

## Failure and deployment

Use existing CAS, lease, session, freshness, and scheduler owners. Snapshot cleanup must remember the replaced reference before a potentially successful Web write. Support the actual old-container/new-Worker overlap without adding a durable owner. Treat scheduler notifications as hints backed by persisted workspace facts, but prove fallback timing before removing them. Document supported version pairs and rollback limits with final implementation.

## Tasks

1. Completed two owner-bound reductions and their regression proof; rejected scheduler suppression after recovery analysis.
2. Review combined source changes, delete unnecessary additions, and update only affected contract owners.
3. Run affected typechecks, complexity diff, and focused verification; inspect privacy and change shape.
4. Commit/push a draft PR, mark the stable candidate Ready, and run ReviewGPT concurrently with required CI.
5. Resolve review under the existing authorization, close the plan, merge after required green gates, and retire the completed checkout.

## Verification

- Browser Vault owner: 24 tests passed; composed background runtime: seven focused tests passed. Restoring unconditional force makes the current-replica case fail on actual write count (one instead of zero); final code passes.
- Snapshot route/ticket: 311 tests passed; invocation bridge: 74 tests passed; two focused orphan-cleanup cases passed. Current completion makes one Web request instead of two, while omitted/legacy baselines retain the read.
- Web checkpoint signal recovery: five focused tests passed, including identical-wake retry after a failed first signal.
- Runtime and Web typechecks passed; runtime emitted package build passed. Cloudflare typecheck found the existing snapshot-ref alias excludes null; the upload-session field now explicitly includes null, and the final Cloudflare typecheck passes. Twelve focused baseline/parser cases pass after the type correction.
- Complexity guard passes with unchanged hotspot debt and maxima; no extraction or new abstraction was needed. Documentation drift and whitespace checks pass.
- Parent review: existing freshness, upload-session, lease, workspace CAS, and garbage-collection owners suffice. The unavoidable additive reference field crosses the actual warm-container rollout boundary; old consumers ignore it, and old producers retain the fallback. No public provider input or foreground call is added.
- Changelog: not applicable; internal background I/O reduction with unchanged product behavior.
- ReviewGPT round 1 passed on `9231d8804363b4aab4347fa8047f057da967aa2f`, with zero findings. Managed Vonneumann lane captured the exact committed turn and matching response hash; model metadata confirms gpt-6-pro. Response arrived more than six minutes after submission, exceeding the 270-second minimum. The reviewer verified full-snapshot metadata and all 13 changed-file blobs, and inspected reference/version binding, cleanup, skew, repair, and preemption; reported tests were not independently executed by the reviewer.
- Parent final review found no further justified source change. Plan closure is explanatory documentation only and does not require another substantive review. Required CI gates the final head before merge.
- Production request reductions remain unmeasured until serving versions converge and comparable work is observed. No whole-bucket target is claimed from per-operation proof.
Completed: 2026-09-09
