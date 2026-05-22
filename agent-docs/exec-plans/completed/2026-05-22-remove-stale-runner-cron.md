# Remove Stale Runner Cron

## Goal

Fully remove the env-gated hosted stale runner cleanup cron surface.

Success criteria:

- `apps/web/vercel.json` no longer schedules `/api/internal/hosted-execution/stale-runner-cleanup/cron`.
- The stale-runner cleanup route, service, and focused tests are removed.
- Operator docs and architecture docs no longer mention `HOSTED_STALE_RUNNER_USER_IDS` or the stale cleanup route.
- Search and targeted verification show no remaining stale cleanup references.

## Constraints

- Preserve unrelated dirty worktree edits and active ledger rows.
- Do not expose local account names, home paths, secrets, user ids, provider payloads, or raw credentials in docs, logs, commits, or final notes.
- Keep `deleteHostedRunnerUserDataBestEffort` intact because account deletion still uses it.

## Scope

- `apps/web/vercel.json`
- `apps/web/app/api/internal/hosted-execution/stale-runner-cleanup/cron/route.ts`
- `apps/web/src/lib/hosted-execution/stale-runner-cleanup.ts`
- `apps/web/test/hosted-stale-runner-cleanup-route.test.ts`
- `apps/web/test/hosted-stale-runner-cleanup.test.ts`
- `apps/web/README.md`
- `ARCHITECTURE.md`

## Plan

1. Remove the Vercel cron entry and stale cleanup route/service/tests.
2. Remove docs and architecture references to the stale cleanup env flag and route.
3. Confirm no stale cleanup identifiers remain.
4. Run targeted web verification and required completion audits.
5. Commit through `scripts/finish-task`.

## Verification

Completed:

- Identifier search for `HOSTED_STALE_RUNNER_USER_IDS`, `stale-runner-cleanup`,
  `runHostedStaleRunnerCleanup`, and related stale cleanup names found no
  remaining active references outside this plan/ledger and immutable completed
  plan snapshots.
- Parsed `apps/web/vercel.json`: remaining crons are hosted onboarding Stripe,
  device-sync dirty sweeper, and hosted execution retention.
- `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts --no-coverage test/device-sync-root-and-stripe-cron-routes.test.ts test/hosted-device-sync-dirty-sweeper-route.test.ts test/hosted-retention-cron-route.test.ts`
  passed.
- `pnpm --dir apps/web lint` passed with unrelated existing warnings in
  `apps/web/src/lib/device-sync/agent-session-service.ts`.
- `git diff --check -- <task paths>` passed.
- `bash scripts/workspace-verify.sh test:diff <task paths>` passed, including
  `apps/web verify`, dev smoke, lint, hosted-web Vitest, and production build.

Pending:

- Scoped commit through `scripts/finish-task`.

## Audits

Completed:

- `security-privacy-review`: no findings. Confirmed account deletion still uses
  the Cloudflare runner user-data deletion path through authenticated settings
  deletion.
- `coverage-write`: no additional test or proof scaffolding recommended.
- `task-finish-review`: no findings.
Status: completed
Updated: 2026-05-22
Completed: 2026-05-22
