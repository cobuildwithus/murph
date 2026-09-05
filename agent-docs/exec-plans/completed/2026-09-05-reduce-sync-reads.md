# Reduce redundant device-sync source reads

Status: completed
Created: 2026-09-05
Updated: 2026-09-05

## Outcome and invariants

Reduce Vercel callbacks by eliminating repeated Junction source reads within a
single uninterrupted admission decision. Preserve fresh authority after provider
fetches and canonical imports, disconnect/reconnect fences, exact coverage and
retry behavior, and hosted/local source semantics.

## Owner and evidence

The Junction provider composes source admission and canonical import. Its hosted
source reader calls the existing signed device-sync snapshot route. Source-scoped
summary and workout admission perform duplicate reads, while empty historical
segments repeat their post-fetch read without an intervening asynchronous effect.
Ordinary timeseries already reuse a source read and need no new cache.

## Design

Pass one current source set explicitly to pure admission helpers. Re-read after
an actual canonical import; retain the first post-provider read for empty results.
Keep authoritative state in the current Web/local store owners. Add no persisted
state, TTL, dependency, protocol field, timer, or cross-job cache. Wire formats
remain unchanged, so old and new Web/Worker combinations remain compatible.

## Tasks

1. Add focused call-count and authority-boundary regressions and prove baseline failure.
2. Remove duplicate reads at the provider composition sites.
3. Run focused provider regressions, package typecheck, complexity and parent review.
4. Record measured synthetic reductions and remaining deployment validation; commit.

## Verification

Synthetic provider jobs exercise empty/populated historical segments, source-scoped
summaries and workouts, source failures, disconnect/reconnect during provider and
import work, and repeat jobs. Existing ordinary-timeseries reuse and historical
coverage regressions remain green. Production savings require deploying the runner
and comparing the snapshot route's traffic under comparable sync load.

## Progress

- Removed redundant reads from source-scoped summary/workout admission and empty
  historical segments. The shared live reader preserves hosted/local fallback;
  historical evidence evaluation now requires explicit source input and is pure.
- Synthetic baseline comparison: six regressions fail against the original source
  because of duplicate reads; the same cases pass with the change. Summary reads
  fall from two to one, first scoped workout admission from two to one, and empty
  historical post-fetch reads from two to one. Populated historical segments retain
  both their pre-import and post-import reads.
- Replaced a read-ordinal-based epoch test with provider-boundary-driven state
  changes. The existing post-canonical-import epoch test remains passing.
- Final focused verification: 339 tests passed across admission source reads,
  blood-pressure backfill, ordinary timeseries source reuse, provider backfill,
  workout streams, history, history recovery, and provider resources.
- `pnpm --dir packages/device-syncd typecheck` passed.
- `pnpm complexity:diff --base HEAD` passed against the unchanged base: debt
  406 to 406 and maximum complexity 145 to 145. Reviewed changed executeJob,
  importTimeseriesPreciseSnapshots, importTimeseriesResourceSnapshot and workout
  composition; the existing large resource executor is unchanged.
- Parent review and `git diff --check` passed. No dependencies, schema, protocol,
  scheduling, prompts, tools, or public behavior changed. Changelog is not
  applicable: this is internal callback work reduction without a new member-facing
  contract. No new repository-actionable Frog friction was encountered.
- Production deployment is separate. The runner bundle must be deployed before
  savings occur; compare snapshot requests and CPU under comparable workload.
  PR-level external review and exact-head CI are tracked by the PR lifecycle.
Completed: 2026-09-05
