# Device checkpoint review remediation

Status: completed
Created: 2026-09-02
Updated: 2026-09-01

## Goal

- Preserve bounded background checkpoint coalescing without publishing a rolled-back threshold write or deferring post-provider exact-delivery durability.

## Success criteria

- The write that reaches the eight-write threshold stays provisional until its checkpoint succeeds.
- A failed threshold checkpoint flushes only the seven previously committed deferred writes.
- Retrying the eighth write produces one mutation and one durable receipt.
- Exact model-free delivery canonical writes use the existing immediate checkpoint path.
- No queue, state machine, durable owner, compatibility layer, or generic exemption framework is added.

## Scope

- In scope: the existing canonical-write coalescer, the exact-delivery boundary call site, and focused rollback/recovery regressions.
- Out of scope: receipt-log format changes, checkpoint schema changes, broader retry policy, or new durability machinery.

## Root-cause evidence

- The current deferred path records the eighth receipt status in shared boundary state before its threshold checkpoint. If that checkpoint throws, the core write transaction rolls the mutation and receipt back locally while the boundary failure flush can still publish the provisional receipt status.
- The exact-delivery path passes the background coalescer across provider effects. A process interruption after provider acceptance can therefore restore a workspace whose published receipt head predates the accepted effect.

## Plan

1. Preview deferred coalescer state without mutating the shared committed state.
2. Publish and clear a threshold candidate only after its checkpoint succeeds; otherwise let the failure boundary flush the prior committed state.
3. Remove coalescing from the exact-delivery boundary so its canonical writes checkpoint immediately.
4. Add focused threshold rollback/retry and exact-delivery durability coverage.
5. Run focused and package verification, finish the scoped commit, push, and complete ReviewGPT plus exact-head CI.

## Deployment concerns

- The change remains confined to the assistant runtime consumed by the Cloudflare runner.
- Web and Cloudflare schemas remain unchanged and mixed versions remain compatible.
- Rollback restores the prior coalescing behavior without migration work.

## Verification

- Passed: threshold rollback/retry and exact-delivery boundary focused regressions.
- Passed: runner, system-mailbox, preemption, and receipt-recovery focused suites (223 tests).
- Passed: assistant-runtime full package suite (2,639 tests passed, 5 skipped).
- Passed: assistant-runtime typecheck, complexity diff, diff check, and privacy/path scan.
- Pending: scoped commit and push, exact-head ReviewGPT round 2, required GitHub checks, merge, and worktree retirement.
Completed: 2026-09-01
