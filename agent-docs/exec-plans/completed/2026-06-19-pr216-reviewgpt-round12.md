# PR 216 ReviewGPT Round 12

## Goal

Fix the accepted ReviewGPT round 12 finding: legacy mailbox fetch cursor
compatibility must rewind only the conversation lane, not the system lane.

## Constraints

- Keep the rolling-deploy compatibility branch narrow and legacy-facing.
- Do not reintroduce runtime-side system replay handling or dual-cursor fetches.
- Preserve current runtime `cursorMode: "imported_seq"` behavior.

## Current Evidence

- ReviewGPT round 12 found that old runtimes can receive stale system rows when
  web uses `min(consumedSeq, importedSeq)` for every lane.
- Old runtime system import expects rows strictly after local imported watermark.

## Verification Plan

- Focused hosted mailbox store and internal route tests.
- Web owner typecheck if TypeScript surfaces changed.
- Diff-aware verification over touched web files before commit/push.

## Verification Complete

- `pnpm --dir apps/web test hosted-mailbox-store.test.ts hosted-runtime-internal-routes.test.ts`
- `pnpm --dir apps/web typecheck`
- `pnpm test:diff apps/web/src/lib/hosted-mailbox/store.ts apps/web/test/hosted-mailbox-store.test.ts apps/web/test/hosted-runtime-internal-routes.test.ts`

## Handoff Notes

- Use `scripts/finish-task` for the scoped commit.
Status: completed
Updated: 2026-06-19
Completed: 2026-06-19
