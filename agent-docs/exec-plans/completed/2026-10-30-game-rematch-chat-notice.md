# Weekly-game rematch chat notice

Status: completed
Created: 2026-10-30
Updated: 2026-10-30

## Goal

Post an addressed rematch in the pair's existing group chat and deliver every
app-origin game change proposal immediately after commit, while preserving the
existing durable sweep as deduplicated recovery.

## Success criteria

1. A rematch inherits and uses only the previous game's bound exact-pair room.
2. One game-keyed notice is reserved with creation and is dispatchable only
   while the rematch remains `invited`.
3. A mutual rematch collapse adds no second notice; missing rooms stay silent.
4. Invite negotiation invokes the same post-commit proposal delivery as later
   app changes, and the sweep cannot duplicate queued work.
5. Deterministic, local PostgreSQL, type, lint, docs and focused real-Codex
   checks pass with synthetic data and no real message send.

## Scope

- In scope: existing weekly-game service, lifecycle receipt/delivery/authority,
  group allowance, notification prompt, focused tests and owner documentation.
- Out of scope: schema changes, new chat creation for rematches, configuration
  flags, production access, provider delivery, commits, pushes and PR work.

## Constraints

- Keep external work after the game transaction and reuse the existing receipt,
  mailbox and idempotency identities.
- Never expose private labels, invite tokens, entry media or internal lifecycle
  language to the group notice.

## Risks and mitigations

1. Acceptance can race queued generation or provider dispatch.
   Mitigation: recheck `invited` both before mailbox publication and in the
   existing provider-dispatch authority transaction.
2. A stale or changed room could expose shared game words.
   Mitigation: inherit only an existing binding and retain exact provider-roster
   verification immediately before publication and dispatch.
3. Immediate delivery and the minute sweep could duplicate a request.
   Mitigation: retain the existing deterministic receipt, mailbox dedupe key and
   generation-queued recovery path.

## Tasks

1. Carry the bound room and reserve one rematch receipt in game creation.
2. Add bound-only, invited-only lifecycle generation and late dispatch authority.
3. Invoke proposal delivery after invite-negotiation commit.
4. Add deterministic, PostgreSQL and real-Codex regression proof.
5. Update the weekly-game owner documentation and complete local verification.

## Decisions

- Reuse `hosted_linq_delivery`; add only the closed `rematch` receipt kind.
- Compare normalized shared rules with stake keys removed, so regenerated
  storage keys do not make an otherwise identical rematch look different.
- Keep the rematch notice out of discovery/bootstrap and temporarily fund only
  its inherited room while its receipt awaits generation.

## Verification

- Frozen install, workspace package build and Prisma generation: passed.
- Hosted-execution prompt test and build: passed.
- Web lifecycle and dispatch-authority tests: passed.
- Web service, change, bootstrap-recovery and chat-access PostgreSQL suites:
  passed against an isolated loopback `murph_test_*` database.
- Web and assistant-engine typechecks and Web lint: passed; lint retained only
  pre-existing warnings outside the changed files.
- Focused real-Codex journey: passed after tightening the false `sameGame`
  branch; reviewed reply was concise, correct, queue-only and provider-free.
- Repository-selected `test:diff`: passed, including affected package tests,
  full Web verification and Cloudflare reverse-dependent verification.
- Docs drift: passed with this plan active; rerun after plan closure.
- Final diff/privacy review: passed.
Completed: 2026-10-30
