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
Current verdict: Hold for real-model proof; deterministic route, acceptance,
policy and checkpoint ordering checks pass.

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
- Changelog generation and changelog-page suite pass (4 tests). The source PR
  list remains empty because this is a local candidate, not a published PR.
- `pnpm complexity:diff` and `git diff --check` pass. Candidate review retained
  the existing state owners, bounded reads and foreground admission. Existing
  large owners were not broadened into a new reminder coordinator.
- Real-model journey added for both producer orders, partial coverage, requested
  repeats, pending output, another date and safety cues. Attempted
  `pnpm test:assistant:live -- --test "shared reminder awareness: 'evening after ordinary reminder'"`
  with the default and available native binaries. Both fail capability preflight:
  `Live journeys require the Murph native patch.` Neither supports
  `app-server --ignore-user-config`; no provider request ran. The existing
  local-live-runner Frog entry covers this prerequisite. Do not infer behavioral
  success from compilation or deterministic prompt assertions.

## Remaining completion gate

Run each uniquely named live journey with the production-patched native Codex
binary through `--codex-command <patched-native-binary>`, inspect its actual reply
and effects, and only then mark Product UX Ready. Keep this plan active until
that proof is available. An eventual PR requires exact-head CI and the routed
final review. This local change does not authorize publication or deployment.
