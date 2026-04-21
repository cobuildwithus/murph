# Norwegian 4x4 research landscape landing

Status: completed
Created: 2026-04-22
Updated: 2026-04-22

## Goal

- Land the supplied Norwegian 4x4 research-landscape patch across Health Commons content, generated outputs, contracts, and the hosted experiment-detail UI without widening beyond that slice.

## Success criteria

- The supplied patch applies cleanly or with only minimal mechanical adaptation to current HEAD.
- The Health Commons schema, catalog validation, protocol/source content, generated artifacts, and hosted experiment-detail projection/UI all match the landed research-landscape shape.
- Required verification runs are completed where the environment permits, and any environment blocker is recorded precisely.
- Required completion audits run before handoff.
- A scoped commit includes only this task's files plus plan closeout.

## Scope

- In scope: the files touched by the supplied patch under `packages/contracts`, `packages/health-commons`, `apps/web/src`, and directly coupled generated artifacts.
- Out of scope: new protocol groups beyond Norwegian 4x4, unrelated experiment-detail redesign, unrelated content cleanup, and speculative test-lane expansion beyond the smallest truthful proof needed for this landing.

## Constraints

- Preserve unrelated worktree edits, including the pre-existing `apps/web/next-env.d.ts` change.
- Do not expose direct personal identifiers in commits, generated files, or handoff.
- Treat the supplied patch as bounded intent, not authorization to widen the scope.

## Tasks

1. [x] Load required repo workflow, verification, frontend, and coordination docs.
2. [x] Inspect the supplied patch and confirm its apply status against HEAD.
3. [x] Apply the patch and inspect the resulting diff.
4. [x] Run the required verification and any minimal direct proof possible in this environment.
5. [x] Run required completion audits and create a scoped commit.

## Verification

- Passed: `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/study-card.test.ts apps/web/test/experiment-detail-protocol-tab.test.ts apps/web/test/health-commons-experiment-detail-page.test.ts`.
- Passed: `pnpm typecheck`.
- Passed: `pnpm --dir packages/health-commons typecheck`.
- Passed: `pnpm --dir packages/health-commons test`.
- Passed: `pnpm test:smoke`.
- Passed: `git diff --check`.
- Failed, unrelated pre-existing blocker: `pnpm --dir apps/web verify` still fails on `apps/web/test/experiment-header.test.ts` and the current diff does not touch `ExperimentHeader`.
- Failed, broader generated drift outside this task's intended scope: `pnpm --dir packages/health-commons generate:check` expects a full regenerate that would also pull unrelated non-Norwegian generated changes already present beyond this landing.
Completed: 2026-04-22
