# Preserve the device import pass scope in hosted execution

Status: completed
Created: 2026-11-10
Updated: 2026-11-10

## Goal

- Activate the existing bounded device-import pass cache through the hosted importer wrapper, avoiding repeated ledger scans without changing canonical results or foreground yield points.

## Success criteria

- The hosted service forwards the optional importer pass scope with its original receiver and encloses the full drain once.
- Composed regression proof fails before the forwarding fix and passes afterward; focused tests and the affected typecheck pass.
- Produce a scoped candidate ready for exact-head CI and ReviewGPT. Runner rollout and natural-traffic observations establish production exposure separately.

## Scope

- In scope: hosted importer method forwarding, regression proof, and its runtime owner documentation.
- Out of scope: cache capacity or invalidation changes, durable state, batching, container sizing, standby inventory, foreground idle timing, and health normalization.

## Constraints

- Technical constraints: retain existing ledger fingerprint checks, 100,000-row resident and 150,000-row pass limits, and pass cleanup on completion or failure.
- Product/process constraints: preserve paying-member responsiveness and all foreground preemption boundaries; keep private observations out of repository artifacts.

## Risks and mitigations

1. A forwarding wrapper can lose its receiver, optionality, result, or error.
   Mitigation: exercise the real hosted wrapper and service drain, including an importer without the optional method and failure cleanup.
2. A hook-only test could miss the actual hosted composition again.
   Mitigation: use the public hosted service factory and real drain for the regression.
3. Cache activation retains more memory during a drain.
   Mitigation: preserve the previously reviewed capacity and scope lifetime; observe runtime errors after deployment. Do not infer fleet savings from a small sample.

## Tasks

1. Prove the wrapper drops the existing hook and reproduce through hosted composition.
2. Forward the method with the smallest change and document the owning boundary.
3. Run focused tests, affected typecheck, complexity and diff checks; review the complete candidate.
4. Prepare the scoped candidate and its release handoff. Track required ReviewGPT, exact-head CI and rollout in the PR and owning session; local completion does not establish deployment.

## Decisions

- The default importer and device worker already implement the pass scope. The hosted wrapper omits it, causing the worker to select its unscoped fallback. Forwarding restores the existing contract without a new cache or state owner.
- Old and new runners read identical persisted formats. Rollout is runner-only; reverting the forwarding loses an optimization but does not change stored data.
- Changelog: not applicable; this restores internal cache wiring without changing product semantics.

## Verification

- Red proof: before forwarding, the receiver/result test and both scoped real-drain cases failed; the composed imports observed no scope. Legacy unscoped controls passed.
- Green proof: all five targeted scope cases pass. The complete hosted wrapper test file passes all seven cases.
- The composed cases use the real hosted factory, service drain and SQLite queue. Multiple jobs share one scope; foreground yield leaves the remaining job queued; continuation enters a fresh scope and both scopes finish.
- `pnpm --dir packages/assistant-runtime typecheck`: passed.
- `pnpm complexity:diff`: passed, zero new complexity debt.
- `pnpm docs:drift` and `git diff --check`: passed.
- Parent candidate review: the three-line receiver-bound forwarding preserves import-error translation, optionality, limits and existing cleanup. No new network or database work, persisted state or provider-input changes.
- Release handoff: rebuild and deploy the runner after required ReviewGPT and exact-head CI pass. Web may remain at the current version because no wire or persisted formats change. Inspect natural-traffic index timings/cache hits and bounded runtime errors after convergence; fleet savings remain unmeasured.
Completed: 2026-11-10
