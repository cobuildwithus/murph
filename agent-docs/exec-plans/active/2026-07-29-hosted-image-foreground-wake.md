# Hosted image foreground wake

Status: active
Created: 2026-07-29
Updated: 2026-07-29

## Goal

- Keep a hosted invocation responsive to newly durable conversation input while
  detached image generation is still running, without delaying or losing the
  image completion.

## Success criteria

- A foreground mailbox wake is admitted by the active invocation while an
  image provider task remains unresolved.
- Image completion still enters the existing pending-input and reply path after
  the foreground turn.
- Dirty image work cannot spin past the existing runtime wake waiter when the
  idle checkpoint window is already due.
- A completed image whose pending-index enqueue repeatedly fails retries only
  at a dedicated non-sliding deadline, while foreground input remains
  admissible.
- Before a graceful snapshot releases a retained completion, its exact input ID
  is staged and registered in the existing pending index or the checkpoint
  fails closed.
- A private-media failure cannot finalize silently when the provider omits its
  required recovery text, and an approved vault-file send cannot lose its
  delivery-owner fence after earlier visible output.
- The correction uses the existing runtime wake signal and image controller;
  it adds no queue, scheduler, retry manager, or persisted owner.
- Focused regression coverage and package typechecks pass locally. Exact-head
  CI and final ReviewGPT remain merge gates for the pushed PR candidate.

## Scope

- In scope: the hosted runtime dirty/image-work wait, deterministic wake
  regression coverage, and directly affected reliability documentation.
- Out of scope: image provider latency, media rendering, new delivery retries,
  mailbox persistence, and Cloudflare wake orchestration.

## Evidence

- Both direct and workflow-backed ensure calls reported an accepted wake while
  the original invocation was active.
- The original invocation did not admit the newly durable conversation input
  before its execution timeout; the replacement invocation admitted it
  immediately.
- Current `main` fails the same hosted image/provider shard, so the failure is
  not introduced by the private-media patch under review.
- The failing test configures a one-millisecond idle checkpoint delay. With
  unresolved image work, the dirty loop can repeatedly observe an already-due
  checkpoint and continue through resolved promises without installing the
  runtime wake waiter.
- The first ReviewGPT debugging response proposed a wider wake-claim lifecycle.
  After receiving the decisive event trace and regression evidence, the same
  review corrected that diagnosis: the proven incident is event-loop starvation
  at the dirty wait, and no claim lifecycle is warranted.
- The corrected review identified one adjacent destructive-consume edge: a
  non-abort foreground import exception could consume the only wake before
  returning a result. The existing notification can be restored locally before
  handing off the watcher; no new state owner is required.
- The final runtime audit identified a retained-completion edge: the controller
  keeps completed image work after two failed pending-index enqueue attempts,
  but an already-due checkpoint let the outer loop retry immediately. A
  deterministic fake-timer regression proved the hot loop before the runtime
  tied subsequent staging batches to a dedicated invocation-local retry
  deadline.
- Follow-up review proved that cursor-based backfill was not sufficient
  shutdown ownership: later foreground completion can advance `eligibleAfter`
  beyond an earlier staged image-completion event. Graceful checkpoint
  preparation now performs a final event-stage attempt when needed and awaits
  exact pending-index registration of every retained completion ID. Either
  failure aborts the snapshot.
- The final private-media audit proved that `reply-required` blocked
  `finish_without_reply` but did not itself guarantee nonblank final text. The
  finalizer now emits one neutral requested-attachment failure sentence only
  when model recovery text is blank, writes it to semantic transcript state,
  and uses the obligation's originating delivery context and selected target.
  Same-context valid media accompanies that recovery; later-context media stays
  on its own final context and target while the recovery becomes an ordered
  preceding segment.
- The same audit proved that a successful vault-file approval could occur
  before generic no-reply eligibility rejected the owner patch. Vault-file
  ownership is now classified immediately after approval, preserving earlier
  visible output as an earlier response segment while fencing later media.

## Tasks

1. Complete the ReviewGPT trace and settle the exact existing owner boundary.
2. Add a deterministic regression that holds image generation while delivering
   a fresh conversation wake.
3. Implement the smallest owner-correct wait-loop correction.
4. Run focused tests, package typechecks, preliminary specialist review,
   product-experience review, and parent review for the final local candidate.
5. Archive the PR-ready local plan in the final scoped commit. Then require
   exact-head CI and final ReviewGPT before merge. Merge, deployment, live
   foreground/image smoke, and worktree retirement remain post-merge work and
   are not claimed by this plan snapshot.

## Decisions

- Treat the accepted active-container wake as proof that ingress and
  orchestration are not the failing owners.
- Preserve foreground priority and the existing image controller as the only
  owner of detached generation work.
- Do not change global wake-signal coalescing semantics unless a deterministic
  reproduction proves that layer loses a notification.
- While image work exists and a runtime wake signal is installed, ignore the
  already-due idle checkpoint only for the current wait. Image completion,
  foreground input, projected assistant work, shutdown, and abort retain their
  existing wake paths. Runtimes without a wake signal retain the existing idle
  checkpoint behavior.
- Keep completed-but-not-enqueued image work on the ordinary idle retry path;
  only unresolved provider work extends the wait to the next real wake. After a
  bounded staging batch fails, one dedicated invocation-local retry deadline
  defers the next batch without being moved by later foreground checkpoint
  debounce; it adds no durable retry owner.
- Before snapshot, make one final staging attempt for a retained completion
  without a cached ID, then await exact idempotent enqueue of each retained ID
  into the existing pending index. Do not rely on cursor backfill; a failure
  aborts the checkpoint.
- If foreground mailbox import throws a non-abort error after consuming a wake,
  restore the same notification before logging and stop that watcher. The next
  existing watcher or outer pass retries it, avoiding both notification loss
  and a same-watcher hot loop.
- Resolve the latest non-vault recovery obligation through the final delivery
  context. If selected model text is blank, synthesize one neutral
  requested-attachment recovery sentence and route it through that obligation's
  context and target. Same-context media stays attached to that reply;
  later-context media stays final on its own context and target while the
  recovery uses the existing preceding-segment/outbox ordering. Ordinary
  media-only replies without a recovery obligation remain unchanged.
- Record successful vault-file ownership independently of generic no-reply
  eligibility. A pre-existing recovery obligation keeps reply-required
  classification and target; otherwise the approved file remains the no-reply
  owner even when earlier output must be preserved as a preceding segment.
- Preliminary specialist finding dispositions:
  - accepted: do not extend the wait for a retained completed image;
  - accepted: approved vault-file guidance yields to an already-required
    visible recovery reply without claiming file delivery;
  - accepted: malformed response-media recovery says the attachment failed,
    not that the underlying image is unavailable;
  - accepted: the foreground/image regression asserts exact origin, follow-up,
    and completion identities, not only payload schemas.

## Verification

- Focused assistant-runtime regression for unresolved image work plus a fresh
  conversation wake.
- Focused retained-completion retry-pacing regression.
- Focused runtime-wake, hosted image-state, response-finalization, vault-owner,
  prompt/tool, and local-delivery regressions.
- Assistant-runtime and assistant-engine package typechecks.
- Exact-head hosted image/provider CI and final ReviewGPT gate after the plan
  archive commit is pushed.

## Verification evidence

- Focused foreground/image regression passed and serviced the origin,
  intervening conversation, and hosted image completion in that order.
- Adjacent focused image-state and runtime-wake suites passed 4/4.
- A prior candidate's complete hosted workspace entrypoint suite passed
  253/253; the final exact-head broad suite remains owned by GitHub CI.
- Assistant-runtime typecheck passed.
- The retained-completion regression proved exactly two immediate enqueue
  attempts, no third attempt before the dedicated deadline, fresh foreground
  admission without moving that deadline, and retry when the original bound
  arrived. It then advanced `eligibleAfter` beyond the completion, proved the
  exact completion ID was indexed inside snapshot creation, and recovered that
  same ID after compaction. The focused entrypoint case passed 1/254.
- Image-controller tests passed 4/4, including a final shutdown-time stage when
  the event had not yet been created and fail-closed exact-index persistence.
- Six current response-finalization and delivery regressions passed: blank
  targeted recovery keeps its originating context and transcript, an earlier
  completed answer becomes a preceding segment instead of masking later
  recovery, same-context valid media accompanies synthesized text, later-context
  media retains its own target after an ordered recovery segment, approved
  vault-file ownership survives earlier visible output, and final media remains
  durably owned when recovery delivery queues.
- Assistant-engine typecheck passed.
- The non-abort import regression injects one failure after one ingress wake,
  then proves two import attempts, one failure log, preserved mailbox
  watermark retry, and follow-up admission by the next assistant pass in the
  same invocation.
- Focused coverage executed the regression successfully; the intentionally
  filtered one-test run then failed only the package-wide aggregate thresholds.
- Local hosted image/provider E2E packaging stopped before test execution
  because the current runner graph exceeded the older macOS byte budget. A
  separate active bundle-ratchet change already records a higher clean
  Linux/macOS measurement; this task does not duplicate or weaken that guard.
  Exact-head Linux CI remains the production-bundle proof.

## Closure boundary

This plan closes at the final scoped PR candidate. Exact-head CI and final
ReviewGPT remain required merge gates. Merge, production deployment, live
foreground/image verification, and worktree retirement are post-merge
operations and are not claimed by this archived snapshot.
