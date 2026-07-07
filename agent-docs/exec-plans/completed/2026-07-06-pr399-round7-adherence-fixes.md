# PR 399 Round 7 Adherence Fixes

## Goal

Implement the three accepted Round 7 findings without committing or pushing:

- Preserve count-less legacy run-plan adherence targets.
- Align server count-path adherence semantics with browser logged-session semantics for partial sessions.
- Reject explicit mismatched experiment session intervention types at write time.

## Constraints

- Do not commit or push.
- Preserve existing round-6 working-tree changes.
- Keep the architecture minimal: reuse existing target synthesis, progress summary, and intervention/experiment matching primitives.
- Add repro tests before production-code changes.

## Plan

1. Add focused regressions in `packages/query` for count-less targets and partial logged-session server/browser alignment.
2. Add a focused `packages/vault-usecases` regression for explicit mismatched session log types.
3. Make the smallest code changes at the owning seams.
4. Run focused package tests, `pnpm typecheck`, and `pnpm test:smoke` if time/resources allow.

## Verification

- `pnpm --dir packages/query test -- experiment-adherence.test.ts experiment-analysis.test.ts browser-vault-experiment-results.test.ts`
- `pnpm --dir packages/vault-usecases test -- experiment-session-intervention-type.test.ts`
- `pnpm --dir packages/cli test -- cli-expansion-experiment-journal-vault-phase2.test.ts`
- `pnpm test:smoke`
- `pnpm typecheck`
- `pnpm --dir packages/contracts test:artifacts`
Status: completed
Updated: 2026-07-06
Completed: 2026-07-06
