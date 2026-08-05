# Usage Reset Capacity Epoch

## Goal

Make automatic hosted usage resets deterministic across delayed accounting,
notice delivery, and repeated plan transitions while preserving credits and
immutable usage history.

## Root Cause

The allowance-period row records only the currently reconciled plan and spend.
It does not retain when an automatic plan reset began or the highest plan tier
whose included allowance has already been granted during the billing period.
Consequently, lock order can assign pre-reset usage to the new allowance,
same-period notices reuse the old claim key, and a Family downgrade followed by
the same upgrade can grant the allowance again.

## Constraints

- Keep the canonical state on `hosted_ai_usage_period`.
- Do not rewrite or delete historical usage or purchased-credit ledger rows.
- Do not add a queue, service, manager, or compatibility state owner.
- Preserve same-plan allowance changes, downgrades, and exact replay behavior.
- Keep the schema migration additive and safe for rolling Web deployments.
- Activate provider-start timestamps before Web classifies usage across a
  reset, and fail closed on ambiguous historical rows.

## Working Set

- `apps/web/prisma/schema.prisma`
- `apps/web/prisma/migrations/**`
- `apps/web/src/lib/hosted-execution/usage-allowance.ts`
- `apps/web/src/lib/hosted-execution/usage-status.ts`
- `apps/web/src/lib/hosted-execution/usage-limit-notice*.ts`
- `apps/web/src/lib/hosted-onboarding/linq-delivery-store.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-transport.ts`
- `packages/assistant-engine/src/assistant/**`
- Focused hosted usage, notice, and PostgreSQL regression tests

## Plan

1. Add an automatic plan-reset timestamp and per-period highest-plan marker to
   the canonical allowance row.
2. Bind usage occurrence to provider-request start where available and forgive
   records whose provider work predates the automatic reset without changing
   credits or spend.
3. Include the reset timestamp in notice eligibility and idempotency, and use
   it as the forecast observation boundary.
4. Allow only a plan above the period's recorded high-water tier to grant a new
   automatic reset.
5. Add unit and real-PostgreSQL proofs for both lock orders, fresh notices,
   trial conversion, credits, and Family downgrade/re-upgrade behavior.
6. Run focused verification, exact-head ReviewGPT stages with CI, parent final
   review, and the normal scoped plan-closing commit.

## Verification

- Focused hosted usage-allowance and usage-status Vitest slices.
- Focused assistant usage occurrence tests.
- Opt-in real-PostgreSQL concurrency and notice proof.
- Hosted web and affected package typechecks.
- `git diff --check`, privacy scan, exact-head required CI, preliminary
  coverage/product specialist review, and final ReviewGPT gate.

## State

Completed.

Focused proof is complete on the corrected candidate: hosted Web, Cloudflare,
assistant-engine, assistant-runtime, and hosted-execution typechecks; 257 Codex
runtime and subagent-usage assertions; 79 Assistant Ask engine assertions; 15
detached Assistant Ask runtime assertions; and seven opt-in real-PostgreSQL
plan-reset assertions. The preliminary pass and final rounds found unsafe
generic cutover timestamps, ambiguous legacy state, incomplete
provider-request starts, an incomplete ops notice key, optional
additional-usage occurrence, an old-Web allowance-insert rollout gap, and
Codex child usage collapsed across reused turns. Remediation records exact
transition metadata, keeps a per-period high-water and reset epoch, makes each
independently billed provider operation own its start, binds notice recovery to
the full epoch, and installs the old-writer bridges in one locked migration
transaction. Codex child usage is now keyed by child thread and child turn,
uses only the observed child start, and calculates one cumulative-total delta
per operation. The fresh-database migration proof applied all 163 migrations;
direct and Family old-column-set inserts now prove exact reset, reused-child
pre/post-cutover accounting, credit preservation, and no second reset. Final
ReviewGPT round 4 passed the per-child-turn correction. The parent cap audit
then found that the first correction spent the existing 32-thread buffer limit
per turn; the follow-up preserves the original distinct-thread cap while
allowing every observed turn on a tracked child to remain independently
billable. The full 257-assertion Codex proof includes a reused turn after all
32 thread slots are occupied. Final ReviewGPT round 5 passed that delta with no
findings. Corrected-head product revalidation also returned no findings, and
the exact merged candidate passed every required GitHub Actions check,
including complete app verification, build/typecheck, both CLI platforms, all
package coverage shards, viewport proof, frontend design proof, fixture
coverage, runner sandboxing, and tracked-artifact hygiene. No unresolved review
threads remain.

Status: completed
Updated: 2026-08-05
Completed: 2026-08-05
