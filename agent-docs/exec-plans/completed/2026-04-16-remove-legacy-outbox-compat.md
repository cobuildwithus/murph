Goal (incl. success criteria):
- Remove the legacy hosted outbox reference-payload compatibility path because this repo is being treated as greenfield.
- Keep the hosted proxy-token fail-closed hardening from commit `415c6168db56`.
- End state: no `/internal/dispatch/legacy-reference` worker route, no web compat dispatch helper, no legacy-reference parsing/drain logic, docs/tests aligned, focused verification green.

Constraints/Assumptions:
- Preserve unrelated in-progress worktree edits, especially the broader `ExecutionOutbox.status` cleanup lane.
- Do not revert the proxy-token enforcement changes in `apps/cloudflare/src/runtime-platform.ts` or `apps/cloudflare/src/runner-outbound/shared.ts`.
- Repo policy requires tests and typecheck after changes.

Key decisions:
- Treat legacy outbox reference rows as unsupported again rather than providing a temporary drain path.
- Remove the route/client/parser/test surface added only for legacy compatibility.
- Keep the final web outbox behavior explicit: unsupported reference payloads are not part of the supported hosted boundary.

State:
- in_progress

Done:
- Confirmed the legacy-support changes came from committed fix `415c6168db56`.
- Identified exact files added for legacy compatibility versus the proxy hardening that should remain.

Now:
- Remove the legacy compatibility route and web drain path.
- Restore tests/docs to the supported greenfield boundary.

Next:
- Run focused Cloudflare and web verification plus repo typecheck.
- Run final review and commit a scoped follow-up.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `apps/cloudflare/src/index.ts`
- `apps/cloudflare/src/worker-routes/shared.ts`
- `apps/cloudflare/test/index.test.ts`
- `apps/cloudflare/test/workers/runtime.test.ts`
- `apps/cloudflare/test/workers/worker-entry.ts`
- `apps/cloudflare/README.md`
- `apps/web/src/lib/hosted-execution/dispatch.ts`
- `apps/web/src/lib/hosted-execution/outbox-payload.ts`
- `apps/web/src/lib/hosted-execution/outbox.ts`
- `apps/web/test/hosted-execution-outbox.test.ts`
- `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts --maxWorkers=1 ...`
- `pnpm exec vitest run --config apps/cloudflare/vitest.workers.config.ts --maxWorkers=1 ...`
- `pnpm test -- test/hosted-execution-outbox.test.ts`
- `pnpm typecheck`
Status: completed
Updated: 2026-04-16
Completed: 2026-04-16
