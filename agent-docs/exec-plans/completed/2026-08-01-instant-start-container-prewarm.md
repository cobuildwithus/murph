# Overlap runner container boot with instant-start enrollment

Status: completed
Created: 2026-08-01
Updated: 2026-08-01

## Goal

- A text-first (instant-start) signup's first Murph reply should not pay the
  runner container cold boot serially after account provisioning. Fire the
  existing payloadless direct runtime ensure as soon as the planner transaction
  that creates the member commits, so the container boots concurrently with
  Stripe trial enrollment, activation, and the replan that appends the first
  conversation mailbox item.
- Measured gap (prod trace, 2026-07-31 first-contact signup): member row
  committed at T+2.4s, direct ensure started at T+5.6s, container ready at
  T+11.4s, provider start at T+15.7s, reply sent at T+24.6s. The ensure can
  start ~3.2s earlier with no new machinery.
- The sender also saw a completely silent chat until the runtime's typing
  session at T+13.4s. Fire one best-effort typing indicator from web at the
  same prewarm point so first perceived feedback lands ~3s after send. The
  substantive-reply floor (container boot + runtime init + generation) stays
  ~18s and is explicitly follow-up work (warm capacity for fresh dispatches,
  first-turn generation budget), not this PR.

## Success criteria

- On the instant-start path, `startHostedDirectRuntimeWakeBestEffort` is
  invoked fire-and-forget with the new member id immediately after the plan
  returns `instantStartEnrollment`, before `ensureHostedLinqInstantStartPulseTrialEnrollment`
  is awaited.
- The prewarm is best-effort: it never blocks, fails, delays, or reorders the
  enrollment, replan, side-effect drain, Temporal mailbox signal, or the
  existing post-Temporal direct ensure. Existing wake-ordering tests
  (`apps/web/test/hosted-onboarding-webhook-wake-direct-ensure.test.ts`) stay
  green and unchanged in meaning.
- Focused Vitest coverage proves: (a) prewarm fires with the enrollment member
  id before enrollment settles; (b) no prewarm on non-instant-start paths;
  (c) enrollment failure does not throw through the prewarm and the fallback
  replan still runs.
- The direct-wake helper's caller policy doc-comment and the owning durable doc
  text about post-Temporal direct wakes are updated to name this one additional
  pre-Temporal prewarm caller and why it is safe (wake = droppable latency
  hint; durable member row committed first; duplicate wakes already handled by
  the existing fence/active-wake path).

## Scope

- In scope: `apps/web/src/lib/hosted-onboarding/webhook-service.ts`
  (instant-start branch), `apps/web/src/lib/hosted-execution/direct-runtime-wake.ts`
  (source union + doc comment), focused web tests, minimal durable-doc update.
- Out of scope: reordering the general Temporal-then-direct-ensure wake path,
  activation-wake changes for web signups, runtime/container boot cost,
  Codex app-server init cost, classifier latency, Temporal orchestration.

## Constraints

- Technical constraints: wake is a droppable replayable latency hint, never
  authority (docs/contracts/00-invariants.md § Ordered Progress). Durable work
  (member + invite in plan tx #2) commits before the hint fires. The prewarm
  must not join the webhook response path budget nor the enrollment
  transaction. `HostedDirectRuntimeWakeSource` is a closed union; add one
  explicit source value for observability.
- Product/process constraints: no new member-facing message or effect; the
  prewarm only affects when the container starts booting.

## Risks and mitigations

1. Risk: the prewarmed attempt starts with an empty mailbox (activation and
   conversation append land 2-5s later) and winds down exactly as the real
   wake arrives, hitting the end-of-invocation race.
   Mitigation: by the time the container is ready (~6s), activation (~2s) and
   the conversation append (~2.5s) have normally committed, so the attempt's
   first mailbox read sees real input; the later Temporal + direct wakes are
   ordinary duplicate wakes into an existing fence (active-wake-accepted
   path). Worst case leaves a warm container for the follow-up wake, which is
   still strictly better than a cold boot. Verify no attempt-swallowing via
   review of the ensure/fence path.
2. Risk: enrollment fails (Stripe error) and the booted container has nothing
   to do.
   Mitigation: bounded waste; instant-start volume is ~2-6/week and failures
   are rare; container idles out on the existing TTL.
3. Risk: fire-and-forget promise escapes error handling.
   Mitigation: `startHostedDirectRuntimeWakeBestEffort` always settles by
   contract; call with `void`.

## Tasks

1. Add `"linq-instant-start"` to `HostedDirectRuntimeWakeSource` and update the
   helper doc comment's caller policy.
2. Fire the prewarm in the instant-start branch of
   `handleHostedOnboardingLinqWebhook` immediately after plan tx #2 returns
   `instantStartEnrollment`.
3. Add `startHostedLinqChatTypingIndicator` and `stopHostedLinqChatTypingIndicator`
   to the web linq-client (same shape as the read-receipt call), fire the start
   best-effort at the same point, and chain a best-effort stop behind the
   in-flight start when the webhook fails before durable continuation exists
   (specialist review finding: the hint must not promise a reply no surviving
   continuation owns).
4. Add focused tests (dispatch test file, matching existing harness patterns).
5. Update the durable doc sentence that says direct wakes are post-Temporal
   only, naming this prewarm caller; add the typing-hint line to
   `agent-docs/operations/imessage-deliverability.md`.
6. Focused local proof + PR + preliminary specialist pass + final ReviewGPT
   gate.

## Decisions

- Reuse `startHostedDirectRuntimeWakeBestEffort` rather than adding a
  container-boot-only route: zero new mechanism, duplicate wakes are already
  safe by design, and the ensure result is best-effort.
- Do not reorder the general Temporal-then-direct wake: that ordering is a
  reviewed design decision (wake-collapse plan); this change is additive on a
  path where the durable follow-up wake is guaranteed by the same request.
- Fire inline (unawaited `void`), not via `scheduleAfterResponse`: `after()`
  tasks run post-response, which would be after the serial work this prewarm
  must overlap.

## Verification

- Commands to run: focused Vitest on the touched web test files; typecheck via
  the narrowest web check; exact-head CI owns the broad suite.
- Expected outcomes: new tests pass; existing wake-ordering and instant-start
  dispatch tests unchanged and green.
Completed: 2026-08-01
