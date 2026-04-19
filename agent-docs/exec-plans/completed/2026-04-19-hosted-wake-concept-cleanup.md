## Title

Clean up leftover hosted-wake terminal and runner compatibility concepts after the recent hard-cut fixes.

## Goal

Remove dead compatibility surface that still advertises terminal `replaced` receipts and the stale runner invoke alias, then archive active execution plans that now describe work already landed.

## Scope

- `packages/hosted-execution/src/contracts.ts`
- focused hosted-execution parser/contract tests
- `apps/web/app/api/internal/hosted-wake/terminal/route.ts`
- focused hosted-wake route/store tests if needed
- `apps/cloudflare/src/runner-container.ts`
- focused Cloudflare runner tests
- `agent-docs/exec-plans/active/*` only for plan closure/move work that this cleanup verifies as complete

## Constraints

- Preserve hosted wake lifecycle-state `replaced`; only remove terminal-receipt `replaced` if no active caller still needs it.
- Preserve unrelated dirty-tree edits in overlapping hosted wake and runner files.
- Remove the old runner invoke alias only if the current code/tests/docs show the canonical path is `/internal/run`.
- Only archive active plans after verification shows the described work is already present in-tree.

## Verification

- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff packages/hosted-execution/src/contracts.ts apps/web/app/api/internal/hosted-wake/terminal/route.ts apps/cloudflare/src/runner-container.ts`

## Notes

- Replacement is already represented by `HostedWakeEvent.replacedByEventId` and hosted wake status responses.
- The container bridge and worker boundary should keep one canonical invoke route now that the hard cut has landed.
Status: completed
Updated: 2026-04-19
Completed: 2026-04-19
