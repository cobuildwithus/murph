# Device import persistence preparation cost

Status: completed
Created: 2026-09-21
Updated: 2026-09-21

## Outcome and scope

Reduce redundant preparation in the canonical device import owner while preserving
exact-delivery replay, evidence repair, source correction, cancellation, and atomic
publication. Existing retained-wake and empty-history scheduling work is owned by
PR #3627 and is excluded. Local session, worktree, and open-PR inspection found no
other identified owner for this canonical preparation change.

## Evidence and design

`importDeviceBatchWithExecutionOptions` prepares persistence, calls
`ensureFullInspection`, then prepares persistence again even when the inspection
was already complete and unchanged. Reconciliation, append planning, and evidence
novelty work are repeated under the same canonical lock. First prove this with a
synthetic import and operation counts, then retain the prepared result when the
inspection did not change. A newly loaded inspection must still rebuild it.

Canonical state and persisted formats stay with their existing owners. No new
cache, durable marker, dependency, or provider shortcut is planned. Preparation
failure and cancellation retain existing behavior. Publication and hosted receipt
durability remain unchanged, so this does not claim to eliminate their cost.

## Product UX

- Outcome: Reduce background import overhead without changing imported facts.
- Reaches: New imports, corrected deliveries, replay, and damaged-history recovery.
- Proof: Synthetic operation-count regression plus canonical import, repair,
  session, cancellation, archived-ledger tests and core typecheck.

## Tasks

1. Reproduce redundant preparation on current source.
2. Apply the smallest owner-local correction and verify new inspection behavior.
3. Run focused checks, inspect privacy and complexity, and commit the scoped fix.

## Verification

- Baseline regression: new imports invoked evidence selection twice; the new
  one-scan assertion failed. Full-history expansion already passed its two-scan
  assertion on baseline and still does after the correction.
- Focused core tests passed: 253 across device-import-preparation, device-import,
  device-import-session, device-import-preemption, event-ledger-storage, and
  integration-ingests. Correction keeps the same event ID and advances its
  revision; replay remains a no-op. Archived writes, repair, and cancellation
  retain the existing regression coverage.
- `pnpm --dir packages/core typecheck`: passed.
- `pnpm complexity:diff`: passed; complexity debt and maximum are unchanged.
  The large existing import owner remains in place; this patch adds no separate
  state owner or helper abstraction.
- Three alternating baseline/candidate Docker benchmark pairs used the existing
  synthetic 8,000-event harness, one vCPU, 3 GiB, no network, and the same image.
  All semantic hashes and canonical readbacks matched. Median wall times (ms)
  were seed 2247/1811, new batch 977/718, disjoint batch 289/119, replay 469/595,
  and correction 185/245. Mixed timing results and host/emulation contention do
  not prove a general latency improvement; the deterministic removed operation
  is the supported efficiency claim. No production throughput claim is made.
- `pnpm docs:drift`, `pnpm docs:gardening`, and `git diff --check`: passed.

## Completion boundary

Implementation and local proof are complete. The hosted canonical-write timing
also includes remote receipt durability; this owner-local preparation change does
not isolate or eliminate that cost. Production measurements and private records
were not copied into fixtures or artifacts. Existing scheduling work remains
with PR #3627, which its existing owner merged during this investigation. No PR,
deployment, restart, or production mutation is part of this
local change; PR review and exact-head CI remain required before shipping it.
Changelog: not applicable for this internal redundant-work removal; member-facing
data semantics and controls are unchanged.
Completed: 2026-09-21
