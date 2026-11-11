# Shared reminder awareness

Status: active
Created: 2026-11-10
Updated: 2026-11-10

## Outcome and invariant

Optional reminders in the same conversation recognize a previously accepted
question about the same person, task and occurrence. Preserve useful uncovered
questions, explicit repeats, safety cues, current audience authority and the
separation between a reminder and task completion.

## Owner and evidence

The notification decision boundary already resolves the audience under the
assistant turn lock. Ordinary scheduled turns read session history; detached
notifications use supplied task context. Neither consistently supplies accepted
outbound evidence from other reminder producers. The existing indexed outbox
route lookup and sent-state evidence own acceptance across sessions. Transcript
text alone can precede acceptance. The cron loop and system-mailbox continuation
can generate another reminder before the existing post-checkpoint dispatch.

## Design

Derive bounded accepted-message context at the shared optional-notification
boundary, using existing route and outbox owners. Reuse the existing skip-policy
classification instead of adding a game-only mechanism or a new capability flag.
Keep required/exact, operator and maintenance notifications unchanged. Preserve
output-only execution and scope the context to the resolved destination.
Reorder existing background work to give queued delivery its checkpoint/dispatch
opportunity before another reminder decision. No new persistent state, schema,
queue, dependencies, cooldown or semantic deduplication service.

## Tasks

1. Add bounded receipt-derived context and deterministic boundary tests.
2. Clarify shared skip guidance and per-task game guidance.
3. Yield background generation at existing delivery boundaries; test ordering.
4. Run focused tests/typechecks, production-derived real-model journeys and
   inspect replies. Update durable contracts and changelog.
5. Review complexity/privacy, commit the scoped implementation and report proof.

## Product UX and proof

Patch: preserve reminder intent while avoiding repeated unanswered questions.
Cover both producer orders, ordinary reminder types, partial coverage, different
people/tasks/dates, requested repeats, safety cues, failed/pending sends,
rotated sessions and private/group isolation. Verify a queued first send reaches
existing dispatch before the next background decision; preserve foreground
preemption. Real-model proof supplements deterministic acceptance/route checks.
Current verdict: Ready. Deterministic boundaries and eight full real-model
journeys pass; actual replies and quiet outcomes were reviewed.

## Failure and release

Unaccepted or unavailable history cannot establish a prior accepted send or
completion. Delayed/ambiguous transport remains with the existing outbox owner;
no indefinite coordination barrier. No persisted/wire format change. Older
runtimes may still repeat reminders until updated; no migration or rollback floor.

## Verification

- Assistant engine: focused notification-history, notification-turn and cron
  Vitest suites pass (442 tests). Both scheduled and detached optional turns
  receive context; required messages retain their contract.
- Assistant runtime: foreground and scheduling suites pass (155 tests), including
  dispatch before a newly due cron decision, causal delivery and pending input.
- Hosted execution: game-chat-notifications suite passes (24 tests).
- Typechecks pass for assistant-engine, assistant-runtime and hosted-execution.
- Changelog generation and changelog-page suite pass (4 tests). The changelog fragment is linked to PR 4818.
- `pnpm complexity:diff` and `git diff --check` pass. Candidate review retained
  the existing state owners, bounded reads and foreground admission. Existing
  large owners were not broadened into a new reminder coordinator.
- Eight production-derived real-Codex journeys pass with GPT-6.1 Sol and local
  subscription authentication: both producer orders, private ordinary reminders,
  partial task coverage, requested repeats, pending output, another date and
  safety cues. Each makes exactly one provider request and creates no automation.
  Covered questions produce no outbox intent; useful reminders produce exactly
  one queued intent. Detached paths call no tools. Actual replies: Ready.
- Command: `pnpm test:assistant:live -- --test "<one exact shared reminder awareness scenario>" --codex-command <patched-native-binary>`.
  Initial native capability preflight was unavailable. A task-owned build of the
  pinned upstream source plus the exact production patch resolved it. No auth
  material was copied, and no messaging provider was called. The fixture's
  evening event key was corrected to the canonical schema before model entry.
- Complete first-provider-request capture uses the real native server with a
  credential-free local Responses stub, identical synthetic base/head inputs,
  and production notification preparation. Base: `9ff8b4a421`.
  Direct/group detached: 31,059 -> 32,293 UTF-8 bytes (+1,234; +3.97%).
  Direct scheduled: 115,398 -> 116,509 (+1,111; +0.96%).
  Group scheduled: 101,349 -> 102,460 (+1,111; +1.10%).
  Captures include instructions, schemas/guidance and history; only transport
  cache identity is excluded and fixture paths normalized. The exact target
  tokenizer is unavailable; byte counts are not token or billing estimates.

## Remaining completion gate

PR 4818 requires final ReviewGPT and green exact-head required CI before merge.
The user authorized PR creation and shipping. Production delivery remains a
separate release outcome from local queued-send proof.

## Shipping follow-up

PR 4818 owns this branch. Reconciled current main's task/date-specific evening
check-in correction, retaining both completed-task handling and prior accepted
reminder coverage. Focused engine boundary tests (121) and game contract tests
(47 passed, one existing skip), plus both affected typechecks, pass after the
merge. The task-owned native build uses the pinned upstream source and exact
production patch and resolves the live-harness capability prerequisite without
modifying another checkout.
