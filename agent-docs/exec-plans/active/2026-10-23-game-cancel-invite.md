# Cancel unstarted game invites

Status: active
Created: 2026-10-23

## Outcome and invariants

Either seated player can cancel an invited or negotiating game. The game becomes
void once under its existing row lock; pending changes and the roster key clear.
Outsiders cannot cancel, started games refuse, repeats write nothing. Home omits
cancelled invites while retaining expired invites. An existing game chat receives
one concise notice through its durable lifecycle receipt; cancellation never
creates a chat. No migration, dependency, or GameView field is needed.

## Owners and evidence

The route and command parser currently have no whole-game cancellation. Home
selects recent void games without distinguishing their events. Extend the current
command/rules/service owners and derive the home exclusion from game_event.
Reuse endGame, runLocked, lifecycle receipts, mailbox dedupe and exact-chat checks.
State and event commit together; provider work remains outside transactions.
Existing runtime notification envelopes already support these instructions.

## Product UX

Effort: product change. Entry: cancel on an unstarted game's waiting card.
Reaches: challenger, negotiating invitee, outsider, started-game player, repeat
caller, immediate new opponent pairing, both home views, existing/no-chat paths.
Proof: route/rule tests, real Postgres transitions and reads, lifecycle recovery,
and one focused real-Codex notice journey. iOS presentation is owned separately.
Done when those paths pass and exact-head review/CI plus production admission,
health and deployment identity are verified. Fix forward only.

## Tasks

1. Implement cancellation and focused regression tests.
2. Update the product contract, changelog and index; run tests/typechecks/guards.
3. Perform the requested read-only Codex deep review; publish the branch and PR.
4. Run eragon ReviewGPT concurrently with CI, resolve gates, merge and verify deploy.

## Verification

Pending: game unit and Postgres suites, Web/package typechecks, focused assistant
journey, complexity:diff, logs:guard, docs:drift, deep review, ReviewGPT and CI.
