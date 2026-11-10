# Measure whole-pass device-sync job stages

Status: completed
Created: 2026-11-10
Updated: 2026-11-10

## Goal

- Attribute every claimed device-sync job in a hosted pass to aggregate stage timings without changing scheduling, publication, or foreground yield.

## Success criteria

- The pass-finished row reports count, total milliseconds, and maximum for each measured stage, plus applied/no-op/failed job-row counts and no-op elapsed time.
- Existing 16 slowest job summaries remain unchanged. The runtime-log parser accepts the full aggregate row.
- Focused owner tests, typechecks, and complexity diff pass; the PR is pushed and ready for external review without deployment.

## Scope

- In scope: pass-scoped in-memory timers in core write batch, hosted receipt publication, Web checkpoint callbacks, device runtime snapshot reads, and local job progress; aggregate existing importer timings.
- Out of scope: changing canonical writes, queue batching, provider behavior, query projection publishing, and deployment.

## Constraints

- Technical constraints: no new awaited operations; flat numeric diagnostics only; one bounded pass owns the collector.
- Product/process constraints: no identifiers or payloads in diagnostics; no slower foreground work; no production mutation.

## Risks and mitigations

1. Stage timings overlap when a provider or canonical write includes nested work. Document that SQL shares are individual shares, not an additive partition.
2. A new runner could emit more keys than an older Web parser admits. Extend and test the parser budget if needed, then deploy Web before the runner image.
3. Timer or logging failure must never alter the canonical result. Keep recording synchronous and use the existing best-effort pass log.

## Tasks

1. Trace owner boundaries and add pass-scoped counters at existing awaits.
2. Verify all job diagnostics are aggregated before the slowest-16 sample is formed.
3. Test field privacy, parser admission, and no change to write/yield ordering.
4. Run focused tests, typechecks, and complexity diff; commit, push, and open a draft PR, then mark ready on the exact head.

## Decisions

- A direct per-pass collector is smaller than a persisted index or new runtime protocol. The counter is diagnostic only.
- Service diagnostics already cover provider, index, and normalization across the full bounded pass; use them as the source of those totals.
- The existing 96-field parser ceiling rejected the expanded pass row, so only `device-sync.pass_finished` receives a 128-field ceiling. Other event limits remain unchanged.
- Existing provider and importer diagnostics report per-claim-group maxima. Mixed batches cannot assign one shared duration to a particular job row; keep exact import outcome totals separately.

## Verification

- `pnpm typecheck`: passed, including Web, runner, core, and service owners.
- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts test/hosted-runtime-maintenance.test.ts --no-coverage`: 167 passed.
- Focused hosted device import, receipt log, core write batch, and runtime-log parser tests: passed.
- `pnpm --dir packages/device-syncd exec vitest run --config vitest.config.ts test/service.test.ts --no-coverage`: 207 passed.
- `pnpm complexity:diff`: passed with no increased complexity debt above the threshold.
- `git diff --check`: passed.
- Production proof remains for the protected Web-first and runner rollout; no production mutation occurred in this task.
Completed: 2026-11-10
