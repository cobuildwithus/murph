## Title

Clear stale DO-local pending commits when hosted wake terminal receipt recording loses the fetch fence.

## Goal

Prevent a stale coalesced wake rewrite from wedging a user behind an orphaned DO-local `pending_commit_json` after web rejects the old wake's terminal receipt as stale.

## Scope

- `apps/cloudflare/src/user-runner.ts`
- `apps/cloudflare/src/web-control-plane.ts`
- `apps/cloudflare/test/user-runner-hosted-wake.test.ts`
- `apps/web/app/api/internal/hosted-wake/terminal/route.ts`
- focused hosted-wake route tests only if needed

## Constraints

- Treat stale terminal receipt rejection like a lost cursor race only when web proves the fetch fence is stale; keep ordinary transient terminal-record failures on the existing backpressure path.
- Clear the stale DO-local pending commit, release the active run for that wake, sync the DO bundle cache back to the current web cursor snapshot, and refetch before running the rewritten wake.
- Preserve the web-owned queue/cursor contract; do not add new Cloudflare-owned correctness state.
- Preserve unrelated in-flight edits across `apps/cloudflare/**` and `apps/web/**`.

## Verification

- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/user-runner.ts apps/cloudflare/src/web-control-plane.ts apps/cloudflare/test/user-runner-hosted-wake.test.ts apps/web/app/api/internal/hosted-wake/terminal/route.ts`

## Notes

- Web already distinguishes stale terminal fetch fences internally via the cursor/wake-identity assertions; surface that path cleanly enough for Cloudflare to recover without weakening route hygiene.
- The regression proof should cover: wake A fetched and committed locally, coalesced row rewritten in place to wake B before terminal receipt recording, stale pending commit cleared, then wake B runs successfully.
- Focused verification passed on 2026-04-19:
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/user-runner-hosted-wake.test.ts -t "drops stale pending cleanup once the web cursor has advanced past that wake seq|commits the finalized pending bundle once and keeps cleanup local-only afterward" --no-coverage`
Status: completed
Updated: 2026-04-19
Completed: 2026-04-19
