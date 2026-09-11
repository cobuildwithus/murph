# Reduce predeploy test latency without dropping proof

## Outcome and protected invariants

Target seven to eight minutes per predeploy gate. Preserve the complete test
inventory, real scheduled wake timing, checkpoint-race recovery, foreground
ordering, native card delivery, and usage pricing assertions. No production
runtime or deploy permission changes.

## Evidence and ownership

The private deploy workflow combines runner preparation with a serial Cloudflare
Node suite. Its reminder scenario chains three independent scheduled journeys
in one test. Public Murph owns that scenario and the existing process-shard
selector; Murph Cloud owns gate scheduling and source-pair build caching.

## Change

Split the reminder into three independently runnable tests with shared signup
setup. Reuse the existing declared process inventory and fail-closed shard
selection. The private workflow runs all three shards and requires their matrix
result, alongside isolated Cloudflare Node shards and fresh image smoke. E2E
build reuse is restricted to the exact public/private source pair. Land public
scenario support before enabling the private matrix.

## Verification

- [x] Focused harness: 68 tests passed. Timing helpers: 2 passed. Both
  hosted-local-harness and Cloudflare typechecks passed.
- [x] Attempted the deterministic hosted-local reminder suite with an isolated
  local database and private worker. Runner preparation stopped before scenario
  execution: unchanged boot closure is 2,054,576 bytes against the existing
  2,046,662-byte budget. Reuse existing bundle-budget friction issue #2375.
  No budget was raised; full E2E timing remains unverified.
- [x] All 100 original assertion lines preserved. Actual Vitest collection
  selects all five tests exactly once across the three reminder patterns
  (3/1/1, including timing helpers). Native Node sharding covers the complete
  local 168-file inventory in three groups of 56 with no duplicates or omissions.
  Both repository diffs reviewed; complexity guard passed with no new debt.
- [x] Private workflow lint and 93 focused workflow/environment tests passed.
  Private typecheck, build, 10 built-worker tests, and full `pnpm verify` passed.
  Paired private commit: `7eb0707` on `perf/cloudflare-predeploy-gates`.
- [x] Timing limits recorded above; docs drift/gardening passed. Implementation
  complete with the E2E build blocker explicitly retained. Close this plan in
  the scoped public commit; public process support must land before the private
  matrix. Changes remain local and actual Actions duration is unverified.

## Completion decisions

Internal test infrastructure only: no member changelog or product UX change.
No paid provider calls, production credentials, deployment, or rollback is needed.
Status: completed
Updated: 2026-09-10
Completed: 2026-09-10
