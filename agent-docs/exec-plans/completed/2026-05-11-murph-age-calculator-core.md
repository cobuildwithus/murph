# Murph Age Calculator Core

## Goal

Add a production-safe Murph Age calculator core that can consume normalized demographic, wearable, and lab `MetricPoint` inputs, run a supplied calibrated model, map risk to an age-like display, and return attribution/uncertainty without promoting current research-only artifacts.

## Scope

- Add pure calculator contracts and scoring helpers under `packages/health-metrics`.
- Support low-dimensional wearable/lab features through the existing metric-selection surface.
- Expand neutral lab definitions for common clinical-aging / PhenoAge-style comparator inputs where they are ordinary lab metrics.
- Keep CRP/hsCRP blocked by default in the calculator path.
- Add focused package tests for scoring, attribution, missing-data abstention, risk-to-age mapping, and blocked inputs.

## Constraints

- Do not import ignored research artifacts or model coefficients into product code.
- Do not make product, clinical, recommendation, protocol, or intervention-actionability claims.
- Preserve unrelated active worktree edits and active coordination rows.
- Keep source rows, source bodies, model internals from ignored research caches, and personal identifiers out of repo files.

## Verification Plan

- `pnpm --dir packages/health-metrics test`
- `pnpm --dir packages/health-metrics typecheck`
- Run broader required checks/audits according to the workflow router before handoff, or report any unrelated blocker explicitly.

## State

- Status: complete
- Started: 2026-05-11
- Completed: 2026-05-11
- Verification: `pnpm --dir packages/health-metrics test`, `pnpm --dir packages/health-metrics typecheck`, `pnpm --dir packages/health-metrics test:coverage`, `pnpm test:smoke`, and scoped `git diff --check` passed. Broader `pnpm typecheck` and `scripts/workspace-verify.sh test:diff ...` are blocked by an unrelated `packages/cli/test/inbox-cli.test.ts` mock runtime-store type mismatch.
Status: completed
Updated: 2026-05-11
Completed: 2026-05-11
