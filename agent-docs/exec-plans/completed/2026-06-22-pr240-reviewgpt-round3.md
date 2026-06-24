# PR 240 ReviewGPT round 3 fixes

Status: completed
Created: 2026-06-22
Updated: 2026-06-21

## Goal

- Resolve accepted ReviewGPT round-3 findings for PR 240 without adding new lifecycle services, stores, schedulers, or broad migration machinery.

## Success criteria

- Legacy snapshot restore cannot re-archive expired raw inbox media that retention should purge.
- Once retention tombstones are committed, the bounded delete phase removes those covered files before honoring wake cancellation.
- Core vault validation reads inbox retention tombstones once per validation pass, not once per capture record.
- Focused regression tests, required checks, and the next ReviewGPT round pass before handoff.

## Scope

- In scope:
  - `packages/assistant-runtime` hosted workspace restore/checkpoint path where legacy raw files are lazily materialized.
  - `packages/inboxd` retention commit/delete ordering and cancellation behavior.
  - `packages/core` inbox retention validation cache lifetime.
  - Focused tests for the accepted findings.
- Out of scope:
  - New retention schedulers, durable pin stores, sensitivity-based retention, or broad snapshot format changes.
  - Any unrelated hosted snapshot/restore refactor.

## Constraints

- Keep deletion/tombstone ownership in existing retention code.
- Keep legacy materialization bounded to eligible raw inbox candidate paths.
- Foreground wake cancellation may interrupt scanning/hashing, but must not leave raw bytes behind after tombstones commit.
- Preserve existing vault validation behavior for single-record callers.

## Risks and mitigations

1. Risk: Legacy migration fix grows into generic eager raw materialization.
   Mitigation: hydrate only candidate raw inbox paths that retention is about to evaluate.
2. Risk: Non-cancellable deletes delay a foreground wake for too long.
   Mitigation: only the bounded batch already tombstoned is non-cancellable.
3. Risk: Validation cache lifetime change changes fail-closed behavior.
   Mitigation: keep the same tombstone key and existing single-record helper path.

## Tasks

1. Verify each round-3 finding against code paths.
2. Add focused regression tests.
3. Implement minimal fixes in the existing owners.
4. Run focused and required verification.
5. Finish the plan, commit, push, and run the next ReviewGPT PR round.

## Decisions

- Accepted the legacy lazy-raw migration finding. The fix adds one optional retention callback that materializes only bounded eligible candidate paths, then reuses the existing hash/tombstone/delete validation path.
- Accepted the post-tombstone cancellation finding. Retention still honors cancellation while scanning and hashing, but the bounded delete loop after tombstone commit no longer accepts the abort signal.
- Accepted the validation cache finding. `validateJsonlValidationFamily` now resolves the family post-validator once for the pass; the single-record helper still resolves its own validator for direct callers.

## Verification

- Commands to run:
  - Focused Vitest tests for changed owners.
  - `pnpm --filter @murphai/inboxd typecheck`
  - `pnpm --filter @murphai/core typecheck`
  - `pnpm --filter @murphai/assistant-runtime typecheck`
  - `pnpm typecheck`
  - `pnpm test:diff`
  - `pnpm docs:drift`
  - `pnpm test:smoke`
  - `git diff --check`
  - Privacy diff scan.
  - Next `pnpm review:gpt pr-review` round after push.
Completed: 2026-06-21
