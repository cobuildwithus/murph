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
4. Run focused local tests, exact-head CI, and the required PR review lane.
5. Close this plan, create the scoped commit, push, and open a pull request.

## Verification

- `node --test scripts/check-frontend-design-proof.test.mjs
  scripts/check-pr-architecture-summary.test.mjs`
- `pnpm --dir packages/assistant-engine exec vitest run
  test/onboarding-goal-checkin-automation.test.ts --no-coverage`
- `git diff --check`
- Exact-head required GitHub Actions.
- Preliminary `completion-specialists` ReviewGPT coverage lens.

## Completion Evidence

- The combined PR-body guard suite passes 15 tests.
- The onboarding goal check-in suite passes 11 tests, including an in-place
  target upgrade for an already-installed pending check-in.
- Preliminary ReviewGPT found two actionable coverage gaps; both are fixed.
  Its requested live model-output comparison was not adopted because this
  change does not alter the prompt contract and the repository has no
  deterministic live-output gate for model selection.
- Exact-head GitHub Actions own the broad verification surface.
Status: completed
Updated: 2026-07-29
Completed: 2026-07-29
