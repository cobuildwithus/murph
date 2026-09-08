# Junction timeseries source-read reuse

Status: completed
Created: 2026-09-04
Updated: 2026-09-04

## Outcome and invariant

Remove the duplicate source acquisition between adjacent timeseries historical
evidence and canonical admission calculations. Preserve full-source canonical
policy, scoped historical evidence, lifecycle fences, cheap exits, and fresh
reads after provider work or canonical writes.

## Evidence and architecture

`importJunctionTimeseriesResourceSnapshot` already reuses lifecycle-fenced
sources. Its unfenced source-scoped path calls the historical helper and then
the canonical preparation wrapper, each acquiring sources. The hosted adapter
fetches a full credential-free connection snapshot for either call and filters
locally. Extend the existing reuse within this function only, with no new
owner, state, cache, dependency, route, or protocol. Source authority remains
with the existing reader; canonical writes remain importer-owned.

## Product UX Patch

Outcome: preserve imported data and recovery while removing one serial read.
Reaches: connected sources, disconnected or unavailable sources, empty results,
and lifecycle-fenced resources; local contexts retain their current fallback.
Proof: provider-executor tests for reads, imported payload, freshness, denied
admission, failure, cancellation, and unchanged continuation/lifecycle behavior.

## Scope and risk

One production function and focused regression proof. Workout, summary,
checkpoint, orchestration, and wire contracts remain outside this task.
Reuse expires at the end of the adjacent calculations. Keep source reads after
provider fetches and before canonical import; never fall back after read failure.
No database fanout or transaction is added: one bounded acquisition disappears
per eligible window, with unchanged maximum cardinality and concurrency.
No mixed-version dependency or migration is introduced.

## Tasks

1. Prove the duplicate with a focused failing regression.
2. Extend existing source reuse and verify all changed branches.
3. Run focused tests, package typecheck, complexity and parent review.
4. Commit, open the PR, run final ReviewGPT alongside required CI, then merge
   after the gates pass and retire the clean worktree.

## Verification

- Before the production edit, the new connected and disconnected scenarios
  failed on the extra adjacent source read; four control cases passed.
- `pnpm exec vitest run --config packages/device-syncd/vitest.config.ts
  --no-coverage` with the source-reuse, provider-resources, provider-backfill,
  provider-history, and fitbit-migration files: 180 passing tests. The final
  source-reuse file adds two empty/skip cases and passes all eight cases.
- `pnpm exec vitest run --config packages/assistant-runtime/vitest.config.ts
  --no-coverage packages/assistant-runtime/test/hosted-device-sync-runtime.test.ts
  -t 'hosted Junction imports reread Web source state|hosted job source reads
  fail closed'`: all three selected composed adapter tests pass.
- `pnpm --dir packages/device-syncd typecheck`: pass.
- `pnpm complexity:diff`: pass; file debt remains 493, maximum remains 145,
  and the touched function remains 28. Removing the fallback branch is the
  proportional simplification; unrelated large functions stay outside scope.
- `git diff --check` and parent scope/privacy review: pass. Product UX: Ready
  for the internal acquisition change; no member-facing behavior or measured
  latency claim. No model input or assistant behavior changes.
- Exact-head CI and final GPT-6 Pro review remain external completion gates.
Completed: 2026-09-04
