# PR 29 Experiment Detail Fixes

## Scope

Fix the merge blockers found in PR #29 for the experiment detail redesign:

- keep expected-signal display data tied to protocol-owned expected values rather than hard-coded fallback estimates
- update focused experiment-detail tests for the new `ProtocolTab` / `ResearchTab` split

## Files

- `apps/web/src/components/experiments/experiment-detail/protocol-tab.tsx`
- `apps/web/app/(dashboard)/experiments/[experimentId]/experiment-detail-client.tsx`
- `apps/web/test/biomarker-layout.test.ts`
- `apps/web/test/experiment-detail-protocol-tab.test.ts`

## Verification

- Focused hosted-web Vitest for `apps/web/test/experiment-detail-protocol-tab.test.ts`
- `git diff --check`
- Additional checks if the focused slice reveals type or app-level issues

## Notes

Preserve unrelated dirty edits in `apps/web/next-env.d.ts` and `apps/web/next.config.ts`.
Status: completed
Updated: 2026-04-28
Completed: 2026-04-28
