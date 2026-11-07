# Operator recap regeneration

Status: completed
Created: 2026-11-01
Updated: 2026-11-01

## Outcome and invariants

Allow an allowlisted operator to regenerate one settled game through its existing
hosted recap turn and group delivery. Default to dry run. Keep the saved story
visible until validation accepts its replacement. Reusing a request id never
creates another turn or delivery. No production access, deployment, messaging,
or merge during implementation; leave the PR draft.

## Architecture and decisions

The existing lifecycle receipt, minute sweep, mailbox notification, recap scope,
write_recap validation and Linq delivery own the whole path. Add a bounded request
id to recap event identity. Use metadata-only game_event request/acceptance rows
for durable idempotency and the existing recap ciphertext for the visible story.
No schema, second queue, backup ciphertext store or client changes are needed.
Serialize admission and acceptance with the existing pair and game row locks;
re-read the roster after the row lock. Reject unsettled, departed, blocked,
disabled, unbound games and overlapping unfinished deliveries. Never mutate a
newer game. Replacement clears the old value atomically at accepted write, not
at operator admission: failure must preserve the old recap.

## Product UX

- Outcome: one fresh accepted story and its normal chat message plus recap URL.
- Entry: Ops command with game id and stable regeneration id; dry run reports
  eligibility and effects, execute durably reserves work for the minute sweep.
- Journeys: operator preview, execute/retry, invalid game, failed/rejected turn,
  duplicate accepted write/delivery, older settled game with a newer rematch,
  and deletion/roster changes between admission and acceptance.
- Proof: route/CLI tests, PostgreSQL concurrency and readback, lifecycle/runtime
  and delivery boundary tests, focused real-Codex recap regeneration journey.

## Tasks

1. Trace owners and implement admission, scoped replacement and event identities.
2. Add deterministic proof, then relevant typechecks and live synthetic proof.
3. Review full diff, privacy, raw-log guard and complexity; update owner docs.
4. Commit, push and open a draft PR with commands, rollout and rollback guidance.
   Report review/CI gates that require Ready if the draft-only boundary blocks them.

## Deployment and rollback

Deploy and converge the additive runtime event reader before enabling Web's new
operator producer. Ordinary first recaps retain their identity. No migration.
Disable new operator requests before rollback; drain outstanding regeneration
turns and delivery before reverting compatible readers. Accepted replacement is
canonical and the old ciphertext is not retained. Never automatically re-send
an uncertain delivery.

## Verification

Passed focused Web route/CLI, lifecycle, validation, delivery and dispatch tests;
15 isolated PostgreSQL cases cover concurrent admission, accepted replacement,
failed-turn preservation, departed/blocked/unsettled refusal, deletion re-read,
rematch preservation and two concurrent real dispatch claims producing one mocked
send. Six runtime identity tests and two assistant delivery tests pass. Web,
assistant-runtime, assistant-engine and hosted-execution typechecks pass. Web
lint passes with existing warnings; logs:guard, complexity:diff, docs:drift and
docs:gardening pass. Changelog generation/render proof passes.

The focused real-Codex journey passed on gpt-6.1-sol via local subscription:
read_game then one accepted write_recap, one outbox intent, exact saved chat line
plus link. Assertions cover recap shape, evidence, lore and rest-day handling.
Logs contain only scenario flags, actions and counts, not story content. Product
UX: Ready for the synthetic supported paths; no production/provider send tested.

Read-only iOS source inspection at 7f3bd7d01745e1ace3dc3428d1746914fa3932df confirms
openLinkedRecap refreshes before openRecap, which uses refreshed Home or game(id:).
The renderer assigns view.recap. The Web handoff reads no story. No client change.

Parent review checked state ownership, privacy, row-lock/deletion ordering,
reservation-to-provider CAS, failed generation, deploy skew and bounded queries.
No new complexity hotspot; existing runtime/protocol hotspots remain unchanged.
Changelog: game-recap-refresh documents the support recovery outcome.

Remaining delivery gates: the requested draft/no-message boundary leaves broad
CI and external ReviewGPT pending. GitHub CI reports explicit draft-admission
failures ("Mark the pull request ready for review to run exact-head CI"); these
are not test failures, and the PR remains draft as requested. Do not merge or deploy this
candidate on the strength of local proof alone. No production access, real
messaging, deployment, rollback, or merge was performed.

## Handoff

Draft PR: https://github.com/cobuildwithus/murph/pull/4425.
Operator command, guards, rollout/rollback and focused evidence are in the PR
and the weekly game spec. Keep the worktree for review. No production action.
Completed: 2026-11-01
