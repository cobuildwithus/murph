# Publish checkpoint latency and canary retention fixes

Status: active
Created: 2026-09-20
Updated: 2026-09-20

## Goal and authority

The user authorized publication and green PR checks after verifying no conflicting
open PR ownership. Keep production deployments and migration execution separate.

## Ownership and base reconciliation

PRs #3600 and #3601 merged while preparing publication. Merge current main into
the owned branch. Preserve the exact new checkpoint transaction body inside the
existing timing wrapper; preserve merged authorization changes untouched. Remaining
open PR overlaps are shared docs or unrelated schema sections, not duplicate
checkpoint-startup or canary-retention implementations. Other worktrees stay untouched.

## Deployment correction

The canonical predeploy migration validator rejected the foreign-key drop in
normal Prisma migrations. Move it to the existing post-promotion contract lane,
make constraint removal idempotent, and update the executable PostgreSQL proof
and live deployment docs. The existing runner verifies production alias and old
function drain before cleanup. No allowlist bypass or new rollout machinery.

## Verification and completion

- [x] Reconcile merged main with exact snapshot-recovery body preservation.
- [x] Run focused Web route, checkpoint timing, deletion and canary tests: 264 pass.
- [x] Web typecheck passes after generating the merged Prisma client.
- [x] Apply additive migrations only to the isolated task database and verify
  snapshot recovery, authorization query counts, trace-deletion fences and cascade.
- [x] Verify migration placement, changelog rendering, lint, docs and complexity.
- [x] Publish draft PR #3602; assign its changelog source and review the final candidate.
- [ ] Start required ReviewGPT on the stable pushed head concurrently with CI.
- [ ] Resolve review and CI, retain exact-head evidence, leave the PR ready.

The first combined PostgreSQL run used the old generated client before merged
schema preparation completed; the next run also lacked the new local recovery
column because the predeploy validator rejected the misplaced contract cleanup.
Correct preparation and migration placement before rerunning that proof.

## Evidence boundaries

Local cold-import timings demonstrate initialization cost, not complete historical
production latency. Prior typing placement changes are absent from the final diff.
Previous completed plans are immutable historical records; this plan and the live
owner docs supersede their original migration-placement instructions.

## Candidate results

After correct local preparation: 55 PostgreSQL tests pass, including all three
snapshot recovery expiry cases, authorization query-count proof, contract SQL
replay, and both trace creation/deletion orders. The canonical migration wrapper
now accepts the candidate; only the additive recovery migration was pending in
the isolated task database. All 69 migration-guard tests and 10 changelog archive
tests pass. Web typecheck, focused ESLint, docs drift, raw-payload logging guard,
whitespace, and current-main complexity guard pass. The only changed-file hotspot
is the unchanged latency-dashboard reader (89); no complexity debt increased.
A repeated current-main import benchmark measured medians 234.06 -> 186.59 ms
across seven fresh processes per variant; current import loads neither SDK.
