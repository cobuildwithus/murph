# Fix failing release verification tests

Status: completed
Created: 2026-04-09
Updated: 2026-04-09

## Goal

- Restore the current `pnpm release:check` failures by fixing the underlying regressions in assistant prompt assembly and hosted onboarding origin validation without broad behavior changes.

## Success criteria

- The assistant grouped auto-reply prompt includes the expected Telegram media-group context for grouped captures when no conflicting album id exists.
- The assistant service runtime tests align with the current system-prompt wording without changing production prompt behavior.
- Hosted onboarding CSRF origin validation rejects request-host preview origins when a canonical public origin is configured and still accepts the canonical origin.
- Focused failing tests pass, then the required repo verification and final audit pass complete for the touched scope.

## Scope

- In scope:
  - `packages/assistant-engine/**`
  - `apps/web/**`
  - focused tests covering the failing assertions
- Out of scope:
  - unrelated release-flow, coverage-harness, or broader hosted-onboarding refactors
  - lint-warning cleanup not required to restore the failing checks

## Constraints

- Technical constraints:
  - Preserve unrelated worktree edits and stay compatible with current prompt/runtime architecture.
  - Keep assistant prompt changes minimal and behavior-preserving outside the failing assertions.
- Product/process constraints:
  - Follow the repo completion workflow for a standard repo change, including required verification, final audit, and scoped commit.

## Risks and mitigations

1. Risk: A prompt-format fix could accidentally change broader automation prompt content.
   Mitigation: Keep the logic change narrowly scoped and verify with the targeted assistant-engine tests.
2. Risk: CSRF-origin tightening could block valid hosted flows.
   Mitigation: Match the existing hosted device-sync pattern and verify with the focused hosted-web CSRF test.

## Tasks

1. Inspect the exact failing assistant-engine and hosted-web code paths behind the reported assertions.
2. Apply the smallest implementation changes that restore the intended behavior.
3. Run the focused failing tests first, then the required broader verification for the touched repo surfaces.
4. Run the required final audit pass, address any findings, and land a scoped commit.

## Decisions

- Use a narrow multi-file plan because the fix spans two subsystems (`packages/assistant-engine` and `apps/web`) but remains bounded to the failing release assertions.
- Keep the current assistant system prompt unchanged and update the stale runtime assertion instead of changing production prompt copy.

## Verification

- Commands to run:
  - focused Vitest commands for the reported failing tests
  - `pnpm --dir apps/web lint`
  - `pnpm typecheck`
  - `pnpm test:coverage`
- Expected outcomes:
  - targeted failures turn green first, then the required repo checks pass or any unrelated blocker is clearly documented.
Completed: 2026-04-09
