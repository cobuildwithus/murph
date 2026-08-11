# Harden appointment reminder ownership

Status: active
Created: 2026-08-10
Updated: 2026-08-10

## Goal

- Make the default private appointment reminder collision-safe when created and
  recoverable by exact owner after provider-thread continuity is unavailable.

## Success criteria

- An initial appointment reminder uses create-only opaque ownership and cannot
  overwrite an existing reminder with a matching semantic title or date.
- The hosted automation tool can read a bounded, current-conversation-only list
  of persisted automation owners without exposing delivery-route identifiers.
- Natural reschedule and cancellation replies patch the original owner and
  never create a replacement or rename its lookup slug.
- Opt-out, tentative, unavailable, unchanged, ambiguous, failed, and
  timing-unverified routes produce truthful final responses.
- Focused tests, exact-head completion reviews, CI, and direct-push acceptance
  pass before the candidate reaches `main`.

## Scope

- In scope: the canonical automation create boundary, the hosted automation
  tool's current-conversation read surface, the typed local create-only CLI
  surface, appointment scheduling policy, focused runtime/tool/prompt tests,
  and real App Server scenario coverage.
- Out of scope: new databases or runtime stores, generic appointment-record
  persistence, route retargeting, frontend changes, and unrelated automation
  behavior.

## Constraints

- Canonical automation records under the vault remain the only durable owner.
- Read results must be current-conversation scoped and omit route fields.
- Existing ordinary upsert behavior remains compatible unless create-only is
  explicitly requested.
- No reminder success claim is allowed unless the initial result proves a new
  record was created or an exact trusted replay recovered it, and timing claims
  match the returned verification fields.

## Risks and mitigations

1. Risk: a generated owner still collides or races with another writer.
   Mitigation: enforce create-only conflict refusal inside the canonical locked
   mutation, not only in the hosted adapter.
2. Risk: a read action leaks automations from another conversation.
   Mitigation: compare each persisted route to the trusted current route before
   serialization and never return route fields.
3. Risk: model tests inject hidden owner context and miss fallback behavior.
   Mitigation: share real tool state across resumed turns and add a fresh scoped
   runtime read proof independent of provider-thread memory.

## Tasks

1. [x] Add canonical create-only ownership and hosted current-conversation list.
2. [x] Update the appointment policy to use create-only save and exact-owner list.
3. [x] Replace synthetic owner tests with stateful lifecycle and fallback proof.
4. [ ] Run focused verification, completion reviews, exact-head CI, and acceptance.
5. [ ] Push the verified candidate to `main`, close the draft PR, and retire the worktree.

## Verification

- Focused core automation tests for create-only collision refusal.
- Focused hosted runtime tests for current-conversation list scoping and response
  redaction.
- Assistant Engine dynamic-tool, policy, model-behavior, planning, typecheck,
  and credential-gated real App Server appointment scenarios.
- Exact-head specialist and final ReviewGPT gates, GitHub checks, privacy/diff
  inspection, and `pnpm verify:acceptance` after final reconciliation with
  `origin/main`.

Completed focused proof:

- All four affected package typechecks pass.
- Core: 782 tests pass.
- Assistant Engine: 91 focused tests pass; 58 credential-gated real App Server
  cases are registered and skipped without the live provider credential.
- CLI: 87 focused tests pass.
- Assistant Runtime: the scoped hosted-automation integration case passes.
