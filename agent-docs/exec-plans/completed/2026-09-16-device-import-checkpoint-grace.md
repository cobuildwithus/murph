# Respect scheduled waits after checkpointed device passes

Status: completed
Created: 2026-09-16
Updated: 2026-09-16

## Outcome and protected behavior

Prevent recent, durably checkpointed import passes from bypassing canonical scheduled-wake grace. Preserve overdue wake detection, unsaved active work, per-connection checkpoint ownership, cycling, and backlog notices.

## Cause and owner

The health reducer admits recent observations independently of the canonical due-wake set. A productive pass followed by a checkpointed no-progress pass after a planned wait can therefore report a stall before the next scheduled wake. The diagnostic reader already owns due-wake admission; the reducer already tracks outstanding snapshots by attempt. Derive whether the latest connection pass is still uncheckpointed from that existing map, and use recent activity as stall evidence only while that pass is unsaved. Do not credit unchanged checkpoints as import progress or create another schedule owner.

## Scope and risks

Web-only health classification, focused synthetic tests, and the reliability owner. No additional queries, persisted fields, provider work, scheduling changes, runtime wire changes, or new abstraction. Older Web readers remain structurally compatible but retain premature paging. Keep unrelated Temporal compatibility and assistant CI environment issues outside this patch.

## Steps

1. Reproduce scheduled-wait false positives and establish checkpoint-ownership counterexamples.
2. Correct the existing reducer and verify unchanged cycling/backlog behavior.
3. Complete focused tests, Web typecheck, complexity review, ReviewGPT, and exact-head CI.
4. Merge through the protected Git deployment path, verify the production alias and alert cron, then retire the task worktree.

## Evidence

- Synthetic regression proof before the fix: six tests fail, 33 existing/boundary tests pass.
- Focused monitor and health suites: 39 passed. Web typecheck passed.
- Complexity diff passed: zero debt/hotspots, maximum remains 18. Diff whitespace check passed.
- Parent review: latest-pass attempt identity uses the existing pending snapshot map; no checkpoint from another attempt or connection grants grace. Due stalls, unsaved active work, cycling, and backlog remain covered.
- External completion gates remain required: ReviewGPT, exact-head CI, protected production admission, deployed SHA/alias, and alert cron verification. The original task owner continues these release checks after implementation-plan closure.

## Product UX and changelog

Internal operator alert correctness only. No member-facing changes or public changelog entry.
Completed: 2026-09-16
