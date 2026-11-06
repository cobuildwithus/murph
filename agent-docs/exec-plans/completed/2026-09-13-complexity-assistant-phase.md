# Separate assistant phase capability and causal maintenance setup

Status: completed
Created: 2026-09-13
Updated: 2026-09-14

## Outcome and invariant

Reduce assistant phase orchestration complexity while preserving optional tool presence, capability object identity, foreground-causal maintenance results and abort cleanup. Existing authority and effect owners remain unchanged.

## Design

Extract optional capability projection and the foreground-causal maintenance branch into private typed functions in the same owner file. Keep the branch's try/finally at its original call site; preserve resource lifetime and all tool property names and omission semantics. No new public contract, persisted state, provider call or dependency.

## Verification and completion

Run focused assistant phase foreground, delivery, scheduling and device-sync tests plus package typecheck, complexity and diff review. Existing deterministic capability and effect assertions own equivalence; no prompt or tool schema construction changes. Publish a scoped PR and start exact-head ReviewGPT alongside CI.

## Results

Assistant phase complexity 128 → 112; file debt 303 → 287. New helpers stay below 20. All 280 focused foreground, delivery, scheduling and device-sync tests passed. Runtime package typecheck and complexity guard passed.

Local candidate review confirmed optional properties retain their exact names, truthiness and object references. Causal maintenance still returns the same result or existing wake fallback, inside the original abort cleanup try/finally. No prompt or dynamic-tool declaration changes. ReviewGPT and exact-head CI remain external gates after publication.
Completed: 2026-09-14
