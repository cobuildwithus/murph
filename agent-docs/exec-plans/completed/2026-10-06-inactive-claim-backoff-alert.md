# Slow admission-denied claims and alert on processing-attempt storms

Status: completed
Created: 2026-10-06
Updated: 2026-10-06

## Goal

- Stop one inactive member from driving about 1,000 Worker ensure-processing
  calls per hour (each with a Web owner claim and runtime-log POST), add a code
  guard so an admission-denied member cannot be retried every three seconds
  again, and alert on any member whose processing attempts storm.

## Success criteria

- Web's owner `claim` response carries an optional `blockedReason`
  (`admission` or `cutover`); the shared parser keeps known reasons on blocked
  claims and drops absent or unknown ones.
- The Worker answers an admission-denied claim with `retry_later` five minutes
  out (reason `admission_blocked`); other blocked claims keep three seconds.
- The runaway monitor opens its incident at 60 `runner.processing_finished`
  rows per subject-hour as well as 25 `runtime.invocation_finished` rows, and
  its email names the dominant processing outcome with allowlisted labels.

## Scope

- In scope: `packages/hosted-execution` owner response contract, Web owner
  command projection, Worker claim retry spacing, the runaway monitor, their
  tests and owning docs. The private scheduler correction (inactive workspace
  quiescence) ships separately in `murph-cloud`; its public contract text is
  recorded in `references/hosted-temporal-orchestration.md`.
- Out of scope: general contention backoff, Cloudflare runtime-log ingestion,
  and new cron, state or migrations.

## Constraints

- Technical constraints: additive, leniently parsed field so Web and Worker can
  deploy in either order; no extra reads on the claim path; one aggregate for
  the monitor.
- Product/process constraints: member activation and inbound work already
  signal the workflow, so slower admission retries must not delay them.

## Risks and mitigations

1. Risk: a reactivated member waits up to five minutes.
   Mitigation: `member-activation-runtime-wake.ts` and inbound `signalWithStart`
   wake the workflow directly; the retry is only the fallback recheck.
2. Risk: false alerts from busy members.
   Mitigation: read-only aggregates over 7,809 member-hours (10 days, known loop
   subjects excluded) show p99 7, p999 16 and max 115 attempts per hour; only 3
   member-hours reached 60, all retry storms.

## Tasks

1. Contract, Web projection and Worker spacing with tests.
2. Monitor query, message and tests, including the real PostgreSQL aggregate.
3. Docs: runtime claim contract, runaway alert, inactive scheduling section.

## Decisions

- Keep `cutover` in the reason set because Web already computes it; only
  `admission` changes Worker behavior.
- Retry and outcome labels use local allowlists, like wake reasons, so a new
  value reads `unknown` (or its bare outcome) rather than leaving the database.
- Changelog: internal reliability and operator alerting; no member-visible
  change.

## Verification

- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/runtime-processing-postgres.test.ts` — 62 passed. With the guard disabled, the new admission case fails (claim_blocked at +3s) and the reasonless case passes.
- Full Cloudflare node workspace — 4,136 passed; the three `runner-bundle-cli-bundle` fixtures stopped at their precondition ("Build the candidate's @murphai/runtime-state public timing exports"), which a fresh worktree lacks; they do not touch the changed files, and CI builds that package first.
- `pnpm --dir packages/hosted-execution test` — 833 passed, including the new owner-response parser test.
- Web: owner route, reconciliation facts, voice control, runaway monitor and latency cron tests — 114 passed.
- Local PostgreSQL (`MURPH_TEST_POSTGRES_CONCURRENCY=1`, migrated task database): `hosted-runtime-owner-postgres` 79 passed (every denied policy in default, system_mailbox and retention returns `blockedReason: "admission"`; cutover phases return `cutover`), `hosted-runtime-member-cutover-postgres` 16 passed, `hosted-runtime-runaway-alert-monitor-postgres` 11 passed.
- `pnpm --dir packages/hosted-execution typecheck`, `pnpm --dir apps/cloudflare typecheck`, `pnpm --dir apps/web typecheck`, `pnpm complexity:diff` (debt 0 -> 0 in all four source files) and `pnpm docs:drift` passed.
- Read-only production run of the new aggregate (27 ms) returned exactly one subject: 0 invocations, 1,039 processing attempts, dominant `retry_later:claim_blocked`.
Completed: 2026-10-06
