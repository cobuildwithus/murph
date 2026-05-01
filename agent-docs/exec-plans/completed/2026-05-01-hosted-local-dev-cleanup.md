# Hosted Local Dev Cleanup

## Goal

Ensure root `pnpm dev` starts the hosted-local web and Cloudflare worker stack from the current checkout and shuts down without leaving stale worker processes or a temporary `.dev.vars` symlink.

Success criteria:

- `pnpm dev` reaches hosted-local readiness.
- Web and worker health endpoints return 200.
- Clean shutdown preserves generated hosted-local state in `apps/cloudflare/.dev.vars`.
- Any source fix is scoped to the hosted-local cleanup path.

## Constraints / Assumptions

- Preserve unrelated Health Commons content edits.
- Do not print `.env` or `.dev.vars` contents.

## Key Decisions

- Keep generated hosted-local state as the surviving `.dev.vars` file on clean shutdown instead of restoring a previous backup.

## State

completed

## Done

- Confirmed `pnpm dev` reached readiness once.
- Cleaned stale worker/Stripe/watch processes from an interrupted run and restored `.dev.vars` to a regular local state file.
- Repaired the current cleanup path so generated hosted-local state replaces the temporary worker symlink on normal shutdown.
- Verified focused hosted-local stack tests, script typecheck, root `pnpm dev` readiness, hosted web health, Cloudflare worker health, and a rendered hosted web page.

## Now

- Closing the plan with a scoped commit.

## Next

- Handoff that the dev server is currently running.

## Open Questions

- None.

## Working Set

- `scripts/dev-hosted-local/stack.ts`
- `scripts/dev-hosted-local/stack.test.ts`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
Status: completed
Updated: 2026-05-01
Completed: 2026-05-01
