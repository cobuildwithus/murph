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
- The correction uses the existing runtime wake signal and image controller;
  it adds no queue, scheduler, retry manager, or persisted owner.
- Focused regression coverage, canonical verification, ReviewGPT, and exact-head
  CI pass.

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

## Tasks

1. Complete the ReviewGPT trace and settle the exact existing owner boundary.
2. Add a deterministic regression that holds image generation while delivering
   a fresh conversation wake.
3. Implement the smallest owner-correct wait-loop correction.
4. Run focused tests, typecheck, canonical verification, preliminary specialist
   review, parent review, and final exact-head ReviewGPT/CI.
5. Merge, deploy the hosted runtime, verify one live foreground/image turn, and
   retire the worktree.

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
  only unresolved provider work extends the wait to the next real wake.
- If foreground mailbox import throws a non-abort error after consuming a wake,
  restore the same notification before logging and stop that watcher. The next
  existing watcher or outer pass retries it, avoiding both notification loss
  and a same-watcher hot loop.
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
- Existing runtime-wake and hosted image-generation suites.
- Assistant-runtime typecheck.
- Canonical `pnpm test:diff` and `pnpm verify:acceptance`.
- Exact-head hosted image/provider E2E and final ReviewGPT gate.

## Verification evidence

- Focused foreground/image regression passed and serviced the origin,
  intervening conversation, and hosted image completion in that order.
- Adjacent focused image-state and runtime-wake suites passed 4/4.
- The complete hosted workspace entrypoint suite passed 253/253.
- Assistant-runtime typecheck passed.
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
