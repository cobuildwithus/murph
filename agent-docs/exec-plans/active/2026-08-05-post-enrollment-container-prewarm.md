# Move instant-start container prewarm after enrollment

Status: active
Created: 2026-08-05
Updated: 2026-08-06

## Goal

- Make the existing instant-start direct runtime ensure warm the foreground
  container instead of creating a background-only attempt that the real reply
  must preempt and destroy.
- Preserve early typing feedback, trial/account authority, the ordinary
  Temporal-then-direct wake, usage enforcement, and foreground recovery.
- Stage the original conversation before signaling the durable activation item,
  without suppressing activation's existing best-effort signal or group-join
  post-commit reconciliation.

## Proven production and code-path evidence

- The sole exact post-prewarm fresh-number trace performed a replacement cold
  start after mailbox acceptance and realized no container-start improvement.
  Its linked invocation recorded a background-to-foreground replacement, a
  fresh Node startup, and cold restore.
- The current Web path starts the full ensure before trial enrollment. At that
  moment the new member is access-inactive, so the workspace read projects AI
  usage as unavailable and Cloudflare correctly binds the attempt to
  `system_mailbox`.
- After enrollment, the real default/foreground wake correctly preempts that
  background fence and destroys its shell. Weakening the usage gate or exact
  preemption cleanup would violate existing safety invariants.
- Moving only the direct ensure was incomplete because instant-start enrollment
  still awaited the activation mailbox Temporal signal before returning. The
  durable system-lane item could therefore start runtime work before the
  conversation lane existed, recreating the same ordering problem.

## Success criteria

- The existing typing hint still begins immediately after the member-creation
  transaction so the sender retains early visible feedback.
- The full direct runtime ensure begins only after successful trial enrollment
  and activation, before the replan that appends the first conversation item.
- Instant-start enrollment returns the committed activation as an explicit
  request-local continuation. The conversation append and ordinary Temporal
  signal happen first; the activation continuation runs afterward on success
  and, once returned, immediately on any later caught failure.
- Enrollment failure starts no runtime prewarm; the existing fallback replan,
  signup-link behavior, and typing-hint cleanup remain intact.
- Pending group-join confirmation materialization still runs through the
  existing activation continuation. A crash before the continuation is handed
  back leaves the activation item durable, but recovery belongs to Linq
  provider redelivery after its 10-second timeout and can take minutes. After
  provider retry exhaustion, a later member wake has no finite recovery bound.
- The ordinary conversation Temporal signal and later direct wake remain
  unchanged and replay-safe.
- Focused ordering/failure tests, Web typecheck, exact-head CI, preliminary
  product/coverage review, and final ReviewGPT pass with no unresolved finding.

## Scope

- In scope: ordering of the existing `linq-instant-start` direct ensure, a
  narrow explicit continuation for its activation post-commit wake, focused
  enrollment/dispatch tests, and directly matching operational documentation.
- Out of scope: the general Temporal/direct-wake ordering owned by the active
  mailbox-wake-collapse plan, Cloudflare fences or preemption, usage policy,
  runner lifecycle, a new readiness-only route, classifier/model work, or
  provider-generation optimization.

## Constraints

- Reuse the existing payloadless best-effort direct ensure; add no control
  route, state owner, retry, queue, fence mode, dependency, or compatibility
  layer.
- Keep the activation mailbox item as the durable source of truth; the returned
  continuation is request-local data, not persisted orchestration state.
- Do not fire before the authoritative enrollment owner reports success.
- Do not await the ensure on the webhook reply path and do not let its failure
  alter enrollment, replan, mailbox append, signaling, or delivery.
- Keep production evidence aggregate and free of message content, phone
  numbers, member ids, provider payloads, or local paths.

## Tasks

1. [x] Correlate the post-prewarm trace and prove the access-mode/preemption
   root cause across Web and Cloudflare.
2. [x] Add focused ordering and enrollment-failure regressions that fail on the
   current placement.
3. [x] Move only the existing ensure to the post-enrollment/pre-replan boundary
   while leaving early typing unchanged.
4. [x] Run focused tests, Web typecheck, docs/diff/privacy checks, and parent
   call-path review.
5. [x] Defer only instant-start's activation post-commit wake, run it after the
   conversation signal or immediately on failure, and preserve group-join and
   crash-window reconciliation.
6. [x] Re-run focused tests, Web typecheck, docs/diff/privacy checks, and parent
   call-path review for the combined correction.
7. [ ] Push the exact candidate and complete required ReviewGPT and CI gates,
   then leave the PR open, unmerged, and undeployed for user review. Reserve
   production measurement for a separately authorized deployment.

## Verification log

- Red proof: the focused Linq dispatch suite ran 164 tests and failed only the
  two new assertions, proving the old placement started prewarm before
  enrollment and once on the enrollment-failure fallback.
- Green proof: the focused Linq dispatch suite passed all 164 tests after the
  relocation.
- Parent review kept the best-effort ensure outside the enrollment error owner,
  guarded it with the existing success flag, corrected the activation-versus-
  conversation Temporal wording, and reran all 164 focused tests successfully.
- Combined red proof: the two focused suites ran 237 tests and failed only the
  three new boundaries: enrollment returned no deferred activation
  continuation, wake-handoff failure did not run it, and the no-conversation
  fallback did not run it.
- Combined green proof: the same two suites passed all 237 tests after the
  explicit continuation and success/failure ordering were implemented.
- A stateful two-attempt regression now models activation committing before the
  continuation returns, then sends the identical raw event again and proves
  one event-id-deduped conversation append plus the ordinary pointer signal.
- The final focused run includes the existing activation/group-join
  continuation owner suite and passes all 240 tests across three files.
- `pnpm --dir apps/web typecheck` passed.
- `pnpm docs:drift` and `git diff --check` passed; the scoped diff and privacy
  scan were clean.
