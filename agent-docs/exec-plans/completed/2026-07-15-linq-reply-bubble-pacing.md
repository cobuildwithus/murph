# Pace Linq reply bubbles

Status: completed
Created: 2026-07-15
Updated: 2026-07-15

## Goal

- Make delimiter-generated Linq reply bubbles feel like one natural texting turn
  by pausing 1.5 seconds between confirmed sends without adding orchestration
  state or restarting the typing indicator.

## Success criteria

- The first Linq bubble sends immediately, and each later sibling bubble waits
  1.5 seconds after the prior sibling reports `sent`.
- Single-bubble Linq replies, Telegram, email, reactions, progress updates,
  unrelated outbox work, and failed or retryable sends do not gain a delay.
- An abort during the pause resets any remaining prepared deliveries before the
  drain exits, preserving retry ownership and shutdown liveness.
- Focused tests, owner verification, coverage review, CI, and the exact-head
  ReviewGPT loop pass with no accepted findings.

## Scope

- In scope: the existing assistant outbox bubble-sequence predicate, hosted
  delivery drain pacing, focused unit/runtime tests, and current iMessage
  deliverability guidance.
- Out of scope: typing-indicator restarts, random jitter, a scheduler, a queue,
  durable pacing state, Telegram pacing, and changes to delimiter generation or
  the four-bubble cap.

## Constraints

- Reuse idempotency-key sequence semantics already owned by the outbox.
- Pause only after a `sent` Linq sibling and keep the wait abortable.
- Preserve unrelated active lanes and working-tree changes.

## Risks and mitigations

1. Risk: a generic drain delay could slow unrelated messages or channels.
   Mitigation: require Linq on both effects, the same delivery boundary, and an
   existing reply-bubble successor relationship.
2. Risk: shutdown during a wait could strand prepared intents in `sending`.
   Mitigation: reset only the remaining prepared effects before propagating the
   abort.
3. Risk: a typing refresh between bubbles could recreate the high-frequency
   typing cycle associated with prior line-health incidents.
   Mitigation: do not add any typing call; Linq clears the existing indicator
   when the first message sends.

## Tasks

1. Register the isolated branch and encode the existing bubble-sequence
   relationship as a small pure outbox predicate.
2. Add the Linq-only 1.5-second abortable wait at the hosted provider-delivery
   boundary.
3. Prove positive pacing, all no-delay cases, and abort/reset behavior with
   focused tests.
4. Update durable deliverability guidance and run required verification and
   coverage review.
5. Close the plan, push, open the draft PR, and run CI and ReviewGPT concurrently
   through `ROUND_OUTCOME: PASS`.

## Decisions

- Use a fixed 1.5-second pause. The reviewed deliverability guide warns against
  burst volume but does not prescribe per-message jitter, so randomization would
  add complexity without evidence.
- Pace only Linq/iMessage. Telegram supports reply bubbles but is outside the
  deliverability and UX concern in this task.
- Do not restart typing between messages. The send already clears Linq typing,
  and repeated typing activity is an avoidable line-health risk.

## Verification

- Focused assistant-engine ordering: 9/9 tests passed.
- Focused assistant-runtime callbacks: 176/176 tests passed, including exact
  nominal 0/1.5/3.0-second dispatch timing, unpaced adjacent reactions and
  unrelated Linq effects, and abort/reset behavior.
- `pnpm typecheck` passed across the repository workspace.
- Assistant-engine owner coverage passed serially: 155 files passed, one
  skipped; 2,242 tests passed, four skipped.
- Assistant-runtime owner coverage passed serially: 74 files passed; 1,697
  tests passed, two skipped.
- The required `coverage-write` pass added only the two missing no-delay cases
  above and reported no remaining proof gap beyond ordinary wall-clock timer
  drift under runtime load.
- The broader diff-aware lane completed the edited-owner and reverse-owner
  suites but remained red in untouched reverse-dependent setup/CLI tests due to
  repeatable existing expansion failures and load-sensitive timeouts. The
  verification router's documented fallback of root typecheck plus both edited
  owner coverage lanes passed.
- Parent final diff review found no additional state owner, queue, scheduler,
  typing lifecycle, or deployment protocol, and no unresolved correctness gap.
- Remaining gates: green PR CI, exact-head ReviewGPT `ROUND_OUTCOME: PASS`, and
  clean merge proof against the latest `main`.
Completed: 2026-07-15
