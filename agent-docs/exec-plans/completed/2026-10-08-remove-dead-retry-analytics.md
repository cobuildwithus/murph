# Remove the unused runtime retry telemetry

Status: completed
Created: 2026-10-08
Updated: 2026-10-08

## Goal

- Delete the retry-response helper, per-reason delay table, and
  `HOSTED_RUNTIME_RETRY_ANALYTICS` Analytics Engine telemetry that lost their
  last production caller when the `UserRunner` coordinator was retired
  (`490acfd725`, 2026-09-17). Only tests exercised them, and the README and SQL
  report described a dataset nothing writes.

## Success criteria

- No source, config, harness, report, or doc reference to the retry helper,
  delay table, binding, dataset, schema, or report remains outside completed
  plans.
- Postgres runtime admission keeps the same accepted recheck horizon and
  retention-conflict retry, now computed directly from the existing timing
  helper.
- Rendered and checked-in Wrangler configs keep the standby analytics binding
  only.

## Scope

- In scope: `apps/cloudflare` source, Wrangler configs, deploy-config renderer,
  README and DEPLOY docs, the retry SQL report, their tests, and the
  hosted-local harness config and test.
- Out of scope: standby inventory analytics, Postgres retry reasons and their
  runtime-log diagnostics, and the runaway alert.

## Constraints

- Technical constraints: no behavior change in runtime admission; no new
  module, binding, or state.
- Product/process constraints: internal telemetry only; no member-visible change.

## Risks and mitigations

1. Risk: a deploy guard or private workflow depends on the binding.
   Mitigation: the private deployment repository has no reference; the retired
   inference-secret guard inspects only secret bindings.
2. Risk: rollback to an older Worker version.
   Mitigation: older versions still declare the binding, and Analytics Engine
   keeps the dataset, so rollback remains valid.

## Tasks

1. Delete the dead helper module, its types, binding type, test, SQL report,
   and report assertions.
2. Inline the owner recheck horizon at its sole consumer.
3. Remove the binding from both Wrangler configs, the renderer, and the
   hosted-local harness, with their tests.
4. Update README and DEPLOY docs.

## Decisions

- Delete rather than revive: the Postgres admission path already records every
  retry reason and `retryAt` in the hosted runtime log, which the runaway
  monitor reads, so a second retry telemetry owner is unnecessary.
- Changelog: internal-only telemetry removal; no member-visible change.

## Verification

- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage`
  on `runtime-processing-postgres`, `operational-report-contracts`,
  `deploy-automation`, and `standby-runner` tests: 211 passed, 2 skipped.
- Hosted-local harness `test/dev-hosted-local/environment.test.ts`: 98 passed.
- `pnpm --dir apps/cloudflare typecheck` and
  `pnpm --dir packages/hosted-local-harness typecheck` pass.
- `pnpm complexity:diff` passes; the deleted module drops max 8 to 0 and the
  harness environment hotspot is unchanged (debt 17 -> 17).
- `pnpm docs:drift` and `pnpm docs:gardening` pass.
- `git grep` finds no remaining reference outside completed plans; the private
  deployment repository has none.
Completed: 2026-10-08
