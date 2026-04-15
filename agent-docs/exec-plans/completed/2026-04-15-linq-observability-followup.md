# Linq Observability Follow-up Cleanup

## Goal

Reduce duplication in the new Linq observability code without changing the diagnostic contract or widening into the active hosted first-contact refactor lane.

## Why

- The first pass landed the right diagnostic shape but duplicated Linq request setup and hosted assistant detail assembly.
- Hosted onboarding now has one-off safe-detail sanitizing logic that should share the existing onboarding logging shape instead of creating a second local pattern.

## Scope

- `packages/operator-config/**`
- `packages/assistant-runtime/**`
- `apps/web/src/lib/hosted-onboarding/**`
- `apps/web/test/**`

## Constraints

- Keep logs redacted and structured.
- Do not edit the active first-contact/home-thread routing flow outside observability-local seams.
- Preserve all unrelated dirty worktree edits.

## Plan

1. Collapse duplicated Linq request setup into one shared request helper while preserving the current error contract.
2. Centralize hosted assistant delivery detail construction so journal, confirmation, and dispatch failures share one metadata shape.
3. Reuse one hosted-onboarding structured-detail sanitizer for Linq side-effect logs.
4. Re-run truthful scoped verification and land a separate scoped commit.

## Verification Target

- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff <touched paths>`
- `pnpm --dir apps/web lint`

## Outcome

- Collapsed duplicated Linq request setup into one shared internal request executor plus one configuration-error helper.
- Centralized hosted assistant delivery detail assembly behind one helper so confirmation, journal, and dispatch-failure metadata stay in sync.
- Reused one hosted-onboarding structured-detail sanitizer for Linq side-effect logs instead of keeping a second local sanitizing helper.

## Verification Result

- Passed: `pnpm --dir packages/operator-config exec vitest run test/http-linq-device-runtime.test.ts test/http-linq-device-runtime-branches.test.ts --config vitest.config.ts --no-coverage`
- Passed: `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-callbacks.test.ts test/hosted-runtime-typing.test.ts --config vitest.config.ts --no-coverage`
- Passed: `pnpm --dir ../.. exec vitest run apps/web/test/hosted-onboarding-linq-transport.test.ts --config apps/web/vitest.workspace.ts --no-coverage --project hosted-web-onboarding-integrations`
- Passed with warnings only: `pnpm --dir apps/web lint`
- Passed: `pnpm typecheck`
- Scoped diff-aware verification again failed only on the pre-existing unrelated `packages/operator-config/test/device-daemon-runtime.test.ts` failures
Status: completed
Updated: 2026-04-15
Completed: 2026-04-15
