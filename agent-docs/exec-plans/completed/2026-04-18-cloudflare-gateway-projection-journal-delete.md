# Cloudflare Gateway Projection Journal Delete

## Goal

Remove `gatewayProjectionSnapshot` from Cloudflare execution-journal correctness state so journal persistence no longer carries gateway projection snapshots while keeping gateway projection as Durable Object-local cache only.

## Scope

- `apps/cloudflare/src/execution-journal.ts`
- `apps/cloudflare/src/user-runner/runner-commit-recovery.ts`
- `apps/cloudflare/src/user-runner/runner-wake-processor.ts`
- focused tests under `apps/cloudflare/test/**` only

## Constraints

- Preserve current recovery behavior aside from dropping journal-level gateway projection persistence.
- Do not revert unrelated branch work.
- Keep edits proportional to this deletion slice.

## Verification

- Prefer `bash scripts/workspace-verify.sh test:diff <paths...>` for the touched Cloudflare files if it truthfully covers the slice.
- Run `pnpm typecheck` after implementation per repo verification rules.

## Notes

- Another active Cloudflare runner lane explicitly avoided these files, so this slice owns the journal/recovery deletion seam.
Status: completed
Updated: 2026-04-18
Completed: 2026-04-18
