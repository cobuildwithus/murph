## Title

Finish the hosted-wake materialization hard cut and clean stale hosted device-sync docs.

## Goal

Remove the remaining Durable Object gate on hosted wake materialization by making Cloudflare call web's canonical materializer on every drain opportunity, then clean the repo docs that still describe removed Cloudflare-owned hosted device-sync control-plane seams.

## Scope

- `apps/cloudflare/src/user-runner.ts`
- focused `apps/cloudflare/test/**` coverage for the hosted wake materialization flow
- `docs/device-sync-hosted-control-plane.md`
- `packages/device-syncd/README.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`

## Constraints

- Keep `apps/web`/Postgres as the canonical owner of hosted due-work truth.
- Use DO-local hints only to schedule the next alarm, not to decide whether web gets to check canonical due rows.
- Preserve overlapping dirty-tree hosted-wake edits already in flight, especially the pre-existing modification in `apps/web/src/lib/hosted-wake/materialize.ts`.
- Keep the docs aligned with current architecture instead of inventing new hosted device-sync seams.

## Verification

- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/user-runner.ts apps/cloudflare/test/user-runner.test.ts docs/device-sync-hosted-control-plane.md packages/device-syncd/README.md`
- focused Vitest commands if the diff-aware lane is blocked by unrelated dirty-tree failures

## Notes

- The direct regression proof for the runtime change is: a drain path with fresh local hints must still call web materialization before fetching wakes.
- The doc cleanup should remove claims that Cloudflare owns canonical device-sync token escrow/runtime authority and align those docs with `ARCHITECTURE.md`.
Status: completed
Updated: 2026-04-19
Completed: 2026-04-19
