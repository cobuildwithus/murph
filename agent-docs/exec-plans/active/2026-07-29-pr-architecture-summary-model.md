# PR Architecture Summary And Check-In Model

## Outcome

- Require every pull request to explain what existing systems it reuses, what
  new logic or abstractions it adds, and what complexity it deliberately avoids.
- Run the onboarding goal check-in with `gpt-5.6-sol` and medium reasoning
  without changing other managed automations.

## Scope

- Pull request template and canonical completion-workflow guidance.
- A focused pull-request body validator, its tests, and its GitHub Actions job.
- The onboarding goal check-in managed seed and focused regression tests.

## Constraints

- Keep the PR summary short and useful rather than adding a broad architecture
  review framework.
- Reuse the existing managed-automation target override.
- Add no new persisted state, scheduling owner, model registry, or automation
  lifecycle abstraction.
- Preserve unrelated active work and repository changes.

## Plan

1. Add the required PR section to the template and completion docs.
2. Add a small, tested pull-request body check that requires concrete bullets.
3. Pin only the onboarding goal check-in to `gpt-5.6-sol` with medium reasoning.
4. Run focused tests, diff-aware verification, and the required PR review lane.
5. Close this plan, create the scoped commit, push, and open a pull request.

## Verification

- `node --test scripts/check-pr-architecture-summary.test.mjs`
- `pnpm --dir packages/assistant-engine exec vitest run
  test/onboarding-goal-checkin-automation.test.ts --no-coverage`
- `pnpm test:diff` for every touched owner.
- `pnpm verify:acceptance`
- `git diff --check`
