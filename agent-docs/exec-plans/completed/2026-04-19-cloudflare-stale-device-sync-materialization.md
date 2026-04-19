## Title

Refresh Cloudflare hosted-wake materialization even when the DO holds a stale future device-sync hint.

## Goal

Prevent a stale future `deviceSyncWakeAt` hint in the Durable Object from suppressing `/materialize` long enough to miss due Postgres-backed device-sync work.

## Scope

- `apps/cloudflare/src/user-runner.ts`
- focused Cloudflare tests in `apps/cloudflare/test/user-runner.test.ts`

## Constraints

- Do not touch `apps/web/**` or shared package files.
- Preserve unrelated in-flight edits in nearby hosted-wake files.
- Prefer a bounded revalidation policy over widening the shared wake-hint contract.
- Keep verification focused on the touched Cloudflare slice.

## Verification

- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/user-runner.ts apps/cloudflare/test/user-runner.test.ts`

## Notes

- Web already owns the authoritative due-device-sync materialization check from Postgres.
- The Cloudflare fix should remove the stale-future-hint blind spot without creating unbounded `/materialize` churn.
- Focused verification passed on 2026-04-19:
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/user-runner.test.ts -t "revalidates stale future device-sync hints on a bounded alarm and drains the materialized wake" --no-coverage`
Status: completed
Updated: 2026-04-19
Completed: 2026-04-19
