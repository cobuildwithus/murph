# Protocol phase timeline reuse

Status: completed
Created: 2026-04-21
Updated: 2026-04-21

## Goal

- Replace the protocol tab's separate baseline/intervention cards with a simplified timeline summary that reuses the existing results progress language and visual model.

## Success criteria

- The protocol tab no longer renders the old stacked baseline/intervention fact cards.
- The "At a glance" section instead shows a compact phase timeline that mirrors the baseline/protocol/analysis structure already used in "Your Results".
- Baseline and protocol durations plus their explanatory copy remain visible.
- Focused `apps/web` tests covering the protocol tab pass, and the required hosted-web verification lane is run or any unrelated blocker is named precisely.
- A scoped commit includes only this task's files plus plan/ledger closeout.

## Scope

- In scope: `apps/web` experiment-detail UI, the shared progress/timeline component if needed, directly coupled protocol-tab tests, and any small doc note required by repo policy.
- Out of scope: experiment protocol content/schema changes, browser-vault run logic, metric/timeline cards in the results tab, and unrelated active experiment-detail UI rows.

## Constraints

- Preserve unrelated dirty-tree edits across `apps/web`, especially the active source-card and signal-hierarchy work.
- Keep this change narrow to the phase-summary/timeline area.
- Do not expose direct personal identifiers in docs, generated files, commit messages, or handoff.

## Tasks

1. [x] Register the task and review the existing results/protocol phase UI.
2. [x] Implement the shared phase timeline/progress UI and wire it into the protocol tab.
3. [x] Update focused protocol-tab tests.
4. [x] Run required verification and completion audits.
5. [x] Create a scoped commit.

## Verification

- `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/experiment-detail-protocol-tab.test.ts`
- `pnpm --dir apps/web typecheck:prepared`
- `bash scripts/workspace-verify.sh test:diff apps/web/src/components/experiments/experiment-detail/protocol-tab.tsx apps/web/test/experiment-detail-protocol-tab.test.ts`
- Direct route proof: `curl -s http://127.0.0.1:3101/experiments/bryan-johnson-blueprint` contained `At a glance`, `Baseline · 7 days`, `Protocol · 14 days`, `21 days to analysis`, and `Protocol window`.
- `frontend-review` audit: no findings; residual note only for human confirmation of narrow-screen label wrapping/spacing.
- `coverage-write` audit on `gpt-5.4-mini`: no additional test changes required.
- `task-finish-review` audit found one protocol-timeline/test drift, which was fixed locally before the final verification rerun above.
Completed: 2026-04-21
