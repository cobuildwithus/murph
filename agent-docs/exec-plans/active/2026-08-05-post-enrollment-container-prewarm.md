# Move instant-start container prewarm after enrollment

Status: active
Created: 2026-08-05
Updated: 2026-08-05

## Goal

- Make the existing instant-start direct runtime ensure warm the foreground
  container instead of creating a background-only attempt that the real reply
  must preempt and destroy.
- Preserve early typing feedback, trial/account authority, the ordinary
  Temporal-then-direct wake, usage enforcement, and foreground recovery.

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

## Success criteria

- The existing typing hint still begins immediately after the member-creation
  transaction so the sender retains early visible feedback.
- The full direct runtime ensure begins only after successful trial enrollment
  and activation, before the replan that appends the first conversation item.
- Enrollment failure starts no runtime prewarm; the existing fallback replan,
  signup-link behavior, and typing-hint cleanup remain intact.
- The later Temporal signal and ordinary direct wake remain unchanged and
  replay-safe.
- Focused ordering/failure tests, Web typecheck, exact-head CI, preliminary
  product/coverage review, and final ReviewGPT pass with no unresolved finding.

## Scope

- In scope: ordering of the existing `linq-instant-start` direct ensure inside
  the instant-start branch, focused dispatch tests, and directly matching
  operational/product documentation.
- Out of scope: the general Temporal/direct-wake ordering owned by the active
  mailbox-wake-collapse plan, Cloudflare fences or preemption, usage policy,
  runner lifecycle, a new readiness-only route, classifier/model work, or
  provider-generation optimization.

## Constraints

- Reuse the existing payloadless best-effort direct ensure; add no control
  route, state owner, retry, queue, fence mode, dependency, or compatibility
  layer.
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
5. [ ] Push the exact candidate, complete required ReviewGPT and CI gates,
   merge, verify the Web deployment, and measure the next eligible trace.

## Verification log

- Red proof: the focused Linq dispatch suite ran 164 tests and failed only the
  two new assertions, proving the old placement started prewarm before
  enrollment and once on the enrollment-failure fallback.
- Green proof: the focused Linq dispatch suite passed all 164 tests after the
  relocation.
- Parent review kept the best-effort ensure outside the enrollment error owner,
  guarded it with the existing success flag, corrected the activation-versus-
  conversation Temporal wording, and reran all 164 focused tests successfully.
- `pnpm --dir apps/web typecheck` passed.
- `pnpm docs:drift` and `git diff --check` passed; the scoped diff and privacy
  scan were clean.
