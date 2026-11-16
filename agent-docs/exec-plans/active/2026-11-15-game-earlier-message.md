# Allow recent player messages for game actions

Status: active
Created: 2026-11-15
Updated: 2026-11-15

## Outcome and boundaries

Allow a player's own message in the same game chat from the last 24 hours to
supply their request or agreement, including before an identical ask existed.
Keep a live group turn required; Web still derives the actor and validates the
room, roster, game and runtime. No new state, flags or transport fields.

## Product UX

- Effort: Product change.
- Entry: A current group message points back to another player's own request.
- Reaches: Recent matching words approve that player's side once; hearsay,
  different terms and expired refs cannot supply their agreement.
- Proof: Runtime passthrough, Web age/actor/revalidation tests, and synthetic
  assistant scenarios for matching words, hearsay and different words.
- Done when: The change is applied using its author's ref, with a truthful
  short reply; refused actions offer the smallest next step.

## Design and investigation

The runtime rejects refs outside acceptedInputIds. Remove that check and keep
the current group-input requirement. Add one 24-hour constant and cutoff to
Web's existing authorizeGameChatActorTx, including mutation revalidation.
Linq wake occurredAt derives from received_at (event timestamp fallback).
Cloudflare egress policy, group port, runtime wrapper, signed Web route and
game dispatcher add no current-turn ref restriction. Proposal resolution keys
use game and proposal IDs; group vote keys also use the actor, never the ref.
Photo source/day/offer restrictions stay owned by their existing photo path.

Web must deploy before the runner: old Web accepts retained refs without an
age limit, while old runners still reject earlier refs. No migration is needed.
Keep the age-checking Web version while the new runner is enabled. No deploy
or merge is authorized by this task.

## Tasks and verification

1. Implement the shared rule and plain prompt guidance; update owner docs.
2. Run focused engine/Web tests and typechecks, the three focused live journeys,
   diff-scoped verification, complexity and changelog checks.
3. Review the diff for privacy, command replay and minimal scope. Commit and
   open a draft PR, complete its source PR metadata, then mark ready and start
   ReviewGPT concurrently with required CI. Do not merge.

## Evidence

Hydration install, incremental build and Prisma generation passed (exit 0).
Focused engine tests: 105 passed; Web game-chat tests: 53 passed; PostgreSQL
room/composer/departure tests: 40 passed; changelog tests: 4 passed (all exit 0).
Engine and Web typechecks, complexity (zero new debt) and docs drift passed
(exit 0). Initial quoting, fixture typing and fixture clock failures were
corrected and their affected checks passed. PostgreSQL's real clock and the
mailbox application clock are aligned explicitly in the photo fixture.

The three real-Codex journeys each passed (exit 0): matching earlier words
approve once with that ref; hearsay and different words cause no write.
Reply review: Ready, short truthful confirmation or the missing consent step.
The harness now carries earlier refs and pending app proposals explicitly.

Diff-scoped verification and complete base/head initial-input measurements
are still running. The first commit is intermediate; PR metadata and plan
closure will be included before marking the candidate ready.
