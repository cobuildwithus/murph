# Hosted account Temporal cleanup

Status: completed
Created: 2026-05-21
Updated: 2026-05-21

## Goal

- Stop or neutralize the per-user hosted Temporal runtime workflow when a
  hosted account is deleted or no longer allowed to run hosted execution.

## Success criteria

- Hosted account deletion best-effort terminates the per-user Temporal workflow
  after the database deletion commits and around hosted runner cleanup.
- Hosted runtime demand returns `blocked` with `user_not_active` for missing,
  suspended, or inactive members instead of honoring stale runtime or explicit
  wake flags.
- Hosted runtime demand returns `blocked` with
  `hosted_runtime_not_configured` when an active member has due run demand but
  no hosted workspace row.
- Focused tests cover deletion termination ordering and demand blocking.
- Durable account-deletion docs describe Temporal workflow cleanup as deletion
  coverage.

## Scope

- In scope: hosted web account deletion, hosted orchestration demand, focused
  hosted web tests, and hosted account deletion docs.
- Out of scope: Cloudflare runner deletion semantics, Temporal workflow loop
  internals, provider revocation behavior, billing state transitions, schema
  changes, and broader hosted Temporal ADR edits owned by other active rows.

## Constraints

- Preserve pointer-only Temporal history and keep termination best-effort.
- Bound Temporal cleanup attempts so a stalled Temporal client cannot block
  Cloudflare cleanup or account-deletion response finalization.
- Do not expose account identifiers, paths, raw payloads, mailbox contents, or
  provider data in logs/docs/tests.
- Preserve unrelated dirty Temporal/env/verifier work in the checkout.
- Do not terminate a still-present account if the Prisma deletion transaction
  fails.

## Risks and mitigations

1. Risk: terminating before the database transaction commits could strand a
   still-active account after a failed delete. Mitigation: terminate only after
   the Prisma deletion transaction succeeds.
2. Risk: blocking every missing-workspace demand could prevent initial hosted
   workspace creation. Mitigation: block only after a run source is selected for
   an active member with no workspace row.
3. Risk: a stalled Temporal connection or termination RPC could block
   best-effort Cloudflare cleanup. Mitigation: apply a short app-level timeout
   to connect and terminate attempts and return a best-effort failure result.

## Tasks

1. Register plan and ledger row.
2. Add a best-effort Temporal workflow termination helper.
3. Call the helper from hosted account deletion after Prisma commit and around
   Cloudflare cleanup.
4. Add active/configured guards to hosted runtime demand.
5. Add focused hosted web tests and doc updates.
6. Run required verification and audits.
7. Close the plan with a scoped commit if overlapping dirty work allows it.

## Decisions

- Treat a missing, suspended, or non-active member as `user_not_active`.
- Treat missing hosted workspace state for selected run demand as
  `hosted_runtime_not_configured`.
- Terminate best-effort after Prisma deletion succeeds, before and after
  Cloudflare cleanup, so a transaction failure does not stop a still-present
  account.

## Verification

- Passed:
  - `pnpm exec vitest run apps/web/test/hosted-account-data-service.test.ts apps/web/test/hosted-orchestration-demand.test.ts apps/web/test/hosted-orchestration-workflow-termination.test.ts --config apps/web/vitest.config.ts --no-coverage` (50 tests)
  - `pnpm typecheck`
  - `pnpm --dir apps/web exec next build` with the same build env defaults as `apps/web/scripts/verify-fast.sh`
  - `git diff --check -- apps/web/src/lib/hosted-privacy/account-data-service.ts apps/web/src/lib/hosted-orchestration/runtime-demand.ts apps/web/src/lib/hosted-orchestration/workflow-termination.ts apps/web/test/hosted-account-data-service.test.ts apps/web/test/hosted-orchestration-demand.test.ts apps/web/test/hosted-orchestration-workflow-termination.test.ts docs/hosted-account-data-deletion-export.md agent-docs/exec-plans/active/2026-05-21-hosted-account-temporal-cleanup.md`
- Notes:
  - `test:diff` completed repo guards and previously passed `apps/web verify`; final reruns after audit fixes were blocked by local app-verify resource kills during the Next build lane.
  - `MURPH_VERIFY_STEP_PARALLEL=0 pnpm --dir apps/web verify` completed tests, lint, and dev smoke, then was killed during Next build TypeScript; the same Next build command passed standalone immediately after.
  - Lint reported unrelated warnings in `apps/web/src/lib/device-sync/agent-session-service.ts`.
  - Earlier `pnpm --dir apps/web test -- ...` wrapper attempts fanned out to broad web workspace tests and hit unrelated failures; focused direct Vitest and `test:diff` passed after `pnpm --dir apps/web prisma:generate`.
Completed: 2026-05-21
