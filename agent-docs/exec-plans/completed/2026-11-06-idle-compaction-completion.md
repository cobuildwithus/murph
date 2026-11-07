# Restore idle compaction independently of scheduled wakes

Status: completed
Created: 2026-11-06
Updated: 2026-11-06

## Outcome and protected boundaries

Outcome: let idle warm conversations compact even when scheduled wakes are near or overdue.
Reaches: scheduled work, including a delivery retry, may wait through the existing compaction budget; fresh input still interrupts it.
Proof: composed maintenance, foreground blockers, retention retry recovery, native repeat suppression, and current-base integration tests.

The idle checkpoint remains the sole admission owner. Required `foregroundWorkPending` blocks compaction; `pendingWork` retains existing cleanup caps and storage exclusions. No new state, reason allowlist, timeout, provider configuration, or persisted schema is introduced. The current shared 120-second timeout and individual/group thresholds remain unchanged.

The old shared pending-work predicate incorrectly made all near scheduled wakes block compaction. Separating its two existing responsibilities fixes that cause. Retention retry selection must consequently use the cleanup decision rather than compaction's outcome.

## Integration and verification

- Captured the reviewed implementation without modifying the active implementation checkout.
- Reconciled the current main branch's clinical-cache cleanup into the existing storage-maintenance owner; preserve its ordinary-idle cleanup and near-wake exclusions.
- Preserve original completed execution records; this plan owns completion evidence.
- Parent review: no additional production-code finding in the captured patch.
- Focused tests passed before integration: 95 tests across four changed boundary suites.
- Current-base proof: 300 runtime tests passed (6 opt-in skips), 2 engine compaction tests passed, 4 changelog rendering tests passed; workspace typecheck and complexity passed (all exit 0).
- Native Codex app-server proof passed using a synthetic local provider: compaction, continuation, and no repeated idle compaction (exit 0). Exact-head CI and external review remain pending.
- The implementation lane finished with 4,402 runtime tests and 4,741 Cloudflare tests passing (exit 0). Its initial test-hook failure was corrected and the complete rerun passed. These runs precede current-main integration and supplement the integrated focused proof.

## Product UX and durability

Ready at the tested runtime boundaries after integrated verification. Pending owner handoff, durable effects, follow-up checkpoints, and exhausted budgets block compaction. Near/overdue wakes retain cleanup caps and skip storage/meal-media work. Fresh notifications and shutdown abort compaction. Compaction failure permits checkpoint publication and successor execution. An unserviced retention retry survives compacted, failed, and no-warm-process outcomes without a replacement wake.

Runtime authority remains bound to attempt and generation. Durable effects retain checkpoint deadlines and save-before-effect ordering; upload sessions begin after maintenance. The existing publication budget already reserves compaction. Cron freshness is unchanged: an already-late occurrence crossing its boundary during compaction expires like any other late wake.

## Release and completion

No wire or stored schema change; old/new runners can coexist. A normal runner release enables the fix, and reverting admission restores prior behavior without a new rollback floor. Deployment is separate and requires the existing authorization boundary. Post-release verification should inspect bounded compaction/checkpoint outcomes and fresh-input interruption.

Public release note: `quieter-long-conversations`. Final ReviewGPT is required for hosted concurrency behavior and must start on the stable pushed candidate concurrently with CI. Preserve and report any capability-limit blocker. The proposed larger context threshold remains outside this change.

## Publication handoff

PR: https://github.com/cobuildwithus/murph/pull/4721. This record closes verified local implementation and parent candidate review. The completion checkout owns this PR; the original implementation branch is retained unchanged. At local closeout, exact-head CI and the Mountain-lane ReviewGPT waiter were active. External review, CI, merge, deployment, and live verification remain separate gates; this record does not claim they passed. The reviewed code candidate is `d30762a27ad466a2fc9760c27d61a544b9d659b5`; this closeout changes documentation only.
Completed: 2026-11-06
