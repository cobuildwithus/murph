# Refactor oversized apps/web TSX components into composable units

Status: completed
Created: 2026-04-08
Updated: 2026-04-08

## Goal

- Reduce oversized `apps/web` TSX files to smaller composable units without changing hosted onboarding, share-link, or settings behavior.

## Success criteria

- Every `apps/web` `.tsx` file is at or below 250 lines.
- Shared controller/state logic lives in `.ts` helpers or hooks instead of monolithic client components.
- `apps/web` lint, typecheck, and test commands pass after the refactor.

## Scope

- In scope:
- `apps/web/src/components/hosted-onboarding/**`
- `apps/web/src/components/hosted-share/**`
- `apps/web/src/components/settings/**`
- Out of scope:
- Route/API behavior changes outside what is required to preserve existing UI behavior.
- Unrelated repo-wide warnings already present before this task.

## Constraints

- Technical constraints:
- Preserve existing hosted onboarding, share import, and hosted settings UX.
- Keep extracted modules within existing hosted-web component boundaries; no dependency changes.
- Product/process constraints:
- Preserve unrelated dirty worktree edits.
- Use scoped verification against `apps/web`.

## Risks and mitigations

1. Risk: Breaking hosted onboarding state transitions while splitting large components.
   Mitigation: Move controller logic into hooks/helpers first, keep presentational sections thin, and rerun `apps/web` tests.

2. Risk: Refactor churn across multiple in-flight hosted-web edits.
   Mitigation: Limit touched paths to hosted onboarding/share/settings components and commit only the scoped diff.

## Tasks

1. Inventory `apps/web` `.tsx` files over 250 lines and identify the ones that mix state, effects, and rendering.
2. Extract hosted onboarding phone-auth controller/state helpers and split join/share stage rendering into smaller sections.
3. Extract hosted settings session-state, controller, and section components so email/Telegram/device-sync pages stay under the threshold.
4. Verify with `pnpm --dir apps/web lint`, `pnpm --dir apps/web typecheck`, and `pnpm --dir apps/web test`.

## Decisions

- Keep backend/API contracts unchanged; this is a UI/composability refactor only.
- Prefer `.ts` controller hooks and pure state helpers for non-JSX logic, leaving TSX files as composition shells plus presentational sections.

## Verification

- Commands to run:
- `pnpm install --frozen-lockfile`
- `pnpm --dir apps/web lint`
- `pnpm --dir apps/web typecheck`
- `pnpm --dir apps/web test`
- Expected outcomes:
- `lint` passes with the repo's existing non-blocking warnings only.
- `typecheck` passes.
- `test` passes.
Completed: 2026-04-08
