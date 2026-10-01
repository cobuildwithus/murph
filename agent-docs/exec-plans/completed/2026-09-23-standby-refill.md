# Keep standby replenishment concurrent and readiness lightweight

Status: completed
Created: 2026-09-23
Updated: 2026-09-23

## Outcome and invariants

Reduce avoidable cold starts under staggered foreground arrivals. Keep the existing
memberless SQLite inventory owner, at most two preparation operations, durable
reservation before I/O, immutable binding, exact image admission and failure recovery.
No pool-size increase, new dependency, queue or persisted state is needed.

## Evidence and design

A synthetic replay of the existing methods proves a second staggered claim leaves
an unused preparation lane until the first replacement finishes. Track active
preparation promises instead of one aggregate pass; start free lanes on each trigger.
Each lane retains bounded attempts, existing SQLite selection and recovery alarms.

Standby currently runs the deployment CLI suite on every pristine slot. Reuse the
existing smoke endpoint with an optional readiness scope: initialize disposable Codex
and prove the shell environment, leaving CLI contract and goal mutation checks to
default deployment smoke. Older containers ignore the query and run the full suite;
old Workers keep the default full suite against new containers. No schema change.

## Product UX: Patch

Outcome: fewer avoidable waits when nearby messages need fresh runtimes.
Reaches: authenticated foreground allocation; retained and cold fallback paths remain.
Proof: staggered claims, two-lane cap, failure/reset recovery, readiness success and
failure, default full smoke and old/new HTTP compatibility. Production improvement
requires the normal release; local proof makes no production latency guarantee.

## Tasks

1. Add a failing staggered-claim regression and correct the coordinator.
2. Limit standby readiness to disposable initialization and shell proof.
3. Verify owner tests/typecheck, compatibility, docs and member release note.
4. Review full diff and complexity, then commit the scoped change.

## Verification and outcome

- Cloudflare standby, container entrypoint and deployed-smoke suites: 211 tests pass.
  Command: `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts
  --no-coverage apps/cloudflare/test/standby-runner.test.ts
  apps/cloudflare/test/container-entrypoint.test.ts
  apps/cloudflare/test/smoke-hosted-deploy.test.ts`.
- The new staggered-claim test fails against the original coordinator at the missing
  second preparation; the candidate passes. A third claim also starts replacement
  while the first preparation remains pending, with a measured peak of two.
- Existing proof covers reset recovery, persisted intents before dispatch, late
  completion retirement, target/mode/release changes and claim replay. Updated
  alarm-failure proof admits the recovered lane without exceeding two preparations.
- The real HTTP entrypoint and smoke adapter run with a simulated Codex wire peer:
  readiness executes initialize and the shell environment command only, rejects
  an invalid environment, closes the child, and publishes readiness only on success.
  Default deployment scope continues into the CLI suite; deployed smoke tests pass.
- `pnpm --dir apps/cloudflare typecheck` and `pnpm --dir apps/web typecheck` pass.
  The fresh checkout first required normal `pnpm --dir apps/web prisma:generate`.
- Changelog generation and `apps/web/test/changelog-page.test.tsx`: 10 tests pass.
- `pnpm complexity:diff` passes: no increase in complexity debt or file maxima.
  Existing entrypoint and container hotspots are unchanged; no unrelated extraction.
- Parent diff review: existing SQLite authority, recovery, image validation and
  immutable binding retained; no dependency, persisted state, endpoint or pool-size
  increase. Preparation tracking replaces aggregate-pass tracking.
- Product UX: Ready for the scoped patch, based on allocation/readiness proof;
  member reply execution and delivery paths are unchanged. Live latency gains need
  production observation after release; no deployment or production mutation performed.
- This task ends in a local scoped commit. Pushed-head CI and final ReviewGPT are
  PR-lane gates and have not run; a later PR must complete them before merge.

## Deployment compatibility

The same container endpoint accepts an optional readiness query; its default remains
full deployment smoke. Prior entrypoints route by pathname and ignore query strings,
so new Workers against old images safely do extra verification. Old Workers against
new images retain full verification. No Web protocol, migration or new rollback floor.
Release through the normal image/Worker pipeline and verify replenishment latency,
standby hit rate, failed preparation counts and foreground typing afterward.
Completed: 2026-09-23
