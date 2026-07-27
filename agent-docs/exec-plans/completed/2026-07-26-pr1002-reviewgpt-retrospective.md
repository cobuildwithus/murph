# pr1002-reviewgpt-retrospective

Status: completed
Created: 2026-07-26
Updated: 2026-07-26

## Goal

- Close PR 1002's ReviewGPT lifecycle findings with the smallest state model:
  deletion remains cancelable before suspension, direct OAuth URL starts cannot
  strand accounts, and companion SDK tokens cannot escape after deletion takes
  authority.

## Success criteria

- Link, direct OAuth, and SDK starts are classified by their proven precommit
  effects without adding persisted state.
- Direct OAuth rejection and expiry cannot permanently block account deletion.
- SDK create and resume keep a deletion-visible guard through token delivery.
- A pending start conflict leaves `HostedMember.suspendedAt` unset, so the
  retry dialog's Cancel action is truthful.
- Focused unit, route, UI, type, lint, and real PostgreSQL race tests pass.
- PR 1002 is pushed, CI is green, and ReviewGPT correction round 3 passes.

## Scope

- In scope: hosted account deletion, device connection start markers, companion
  SDK token delivery, focused tests, PR evidence and retrospective notes.
- Out of scope: provider onboarding redesign, new tables or lifecycle services,
  unrelated connection flows, merging the draft PR.

## Constraints

- Technical constraints: reuse the marker, member row lock, provider descriptor,
  and response-lifecycle primitive already present in the repository; never hold
  a database transaction across provider I/O.
- Product/process constraints: preserve product-critical connection and deletion
  flows, keep the PR draft, and keep this work inside bug-hunt round 1 of exactly
  three total rounds.

## Risks and mitigations

1. Risk: consuming the SDK marker before the HTTP response revives the token
   escape race.
   Mitigation: remove the marker only from a post-response callback while
   holding the active-member lock.
2. Risk: treating an owner-creating start as URL-only could skip required
   cleanup.
   Mitigation: derive cleanup behavior from the existing provider descriptor and
   fail closed for unknown or owner-creating families.
3. Risk: marker preflight outside the suspension lock could race a new start.
   Mitigation: recheck markers in the same transaction that locks and suspends
   the member.

## Tasks

1. Confirm the exact effects and terminal point for Link, direct OAuth, and SDK.
2. Implement descriptor-based direct OAuth cleanup and atomic pre-suspension
   marker rejection.
3. Keep SDK markers through create/resume token delivery and finalize them after
   the response.
4. Add the required rejection, expiry, suspension, and paused-token race proofs.
5. Run scoped verification, update PR evidence, push, and complete ReviewGPT
   correction round 3 concurrently with CI.

## Decisions

- Upstream owner creation, local connection commitment, and companion token
  delivery are distinct effects.
- Direct OAuth has no upstream or local precommit effect; Link may create an
  upstream owner; SDK token mint may create or resume an upstream session and
  token delivery is its terminal effect.
- Account deletion is pre-start and cancelable until the member suspension
  commits. A pending marker must therefore reject deletion before suspension.
- Use deletion/reversion of premature marker consumption, not a new table,
  state machine, queue, or manager.

## Verification

- `pnpm --dir packages/device-syncd test`: 44 files and 871 tests passed.
- Hosted focused suites: 255 tests passed; 14 opt-in tests skipped in the
  ordinary local lane.
- Real PostgreSQL lifecycle suites: 82 tests passed after applying the
  repository's pending migrations to the isolated task database.
- Device-syncd and hosted-web typechecks passed.
- Affected hosted-web ESLint passed with zero errors.
- Workspace boundary and dependency-cycle checks passed after replacing a
  rejected daemon-root test import with explicit public subpaths.
- Crabbox `pnpm test:diff`: Testbox
  `tbx_01kygqrxgje173p5n1nqkh4c1m`; dependency, workspace-boundary, affected
  typecheck, device-syncd (871 tests), and other affected package suites passed
  before the unchanged `packages/vault-usecases` generated Health Commons
  artifact-path failure.
- Crabbox `pnpm verify:acceptance`: passed in Testbox
  `tbx_01kygrgkxqzmy1a16g8jxkyyrj`
  ([Actions run](https://github.com/cobuildwithus/murph/actions/runs/30233692815)).
Completed: 2026-07-26
