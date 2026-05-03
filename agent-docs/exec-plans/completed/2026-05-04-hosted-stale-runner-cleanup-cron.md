# Hosted Stale Runner Cleanup Cron

## Goal

Add a production cron path that can clean up explicitly listed stale hosted runner Durable Objects through the existing Cloudflare hosted-control deletion client.

## Constraints

- Do not commit raw stale hosted member ids.
- Cron must require the existing Vercel cron bearer authorization.
- Cleanup must skip any candidate id that still exists in `HostedMember`.
- Cloudflare cleanup must use the existing hosted runner deletion client, not a new broad Cloudflare admin surface.
- Preserve unrelated dirty work in `apps/web` and the coordination ledger.

## Plan

1. Add a small hosted-runner stale cleanup library that reads candidate ids from environment configuration.
2. Validate candidates, dedupe them, check `HostedMember`, and delete only missing members through `deleteHostedRunnerUserDataBestEffort`.
3. Add a Vercel cron route and schedule.
4. Add focused tests for parsing, DB safety skip, and delete invocation.
5. Run scoped verification and required reviews, then commit only this task's files.

## Verification

- `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts test/hosted-stale-runner-cleanup.test.ts --no-coverage` passed.
- `pnpm --dir apps/web typecheck` passed.
- `bash scripts/workspace-verify.sh test:diff apps/web/src/lib/hosted-execution/stale-runner-cleanup.ts apps/web/app/api/internal/hosted-execution/stale-runner-cleanup/cron/route.ts apps/web/test/hosted-stale-runner-cleanup.test.ts apps/web/vercel.json apps/web/README.md ARCHITECTURE.md agent-docs/exec-plans/active/2026-05-04-hosted-stale-runner-cleanup-cron.md` passed.
- `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts test/hosted-stale-runner-cleanup.test.ts test/hosted-stale-runner-cleanup-route.test.ts --no-coverage` passed.
- `bash scripts/workspace-verify.sh test:diff apps/web/src/lib/hosted-execution/stale-runner-cleanup.ts apps/web/app/api/internal/hosted-execution/stale-runner-cleanup/cron/route.ts apps/web/test/hosted-stale-runner-cleanup.test.ts apps/web/test/hosted-stale-runner-cleanup-route.test.ts apps/web/vercel.json apps/web/README.md ARCHITECTURE.md agent-docs/exec-plans/active/2026-05-04-hosted-stale-runner-cleanup-cron.md` passed.
- `git diff --check` on task files passed.
- Targeted leakage check found no raw hosted member ids or local account path residue in task files.
- Security/privacy review returned no findings.
- Final completion review findings were addressed by adding the route-level regression test and recording completed verification.
Status: completed
Updated: 2026-05-04
Completed: 2026-05-04
