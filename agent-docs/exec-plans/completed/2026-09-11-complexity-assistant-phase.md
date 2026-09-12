# Simplify system mailbox assistant maintenance orchestration

Status: completed
Created: 2026-09-11
Updated: 2026-09-11

## Goal and invariant

Reduce the maintenance orchestrator's cyclomatic complexity while preserving mailbox selection, foreground priority, delivery idempotency, wake selection, and checkpoint ordering. The existing workspace assistant phase remains the owner; no state, protocol, model input, or authority changes.

## Evidence and design

The guard identified `runSystemMailboxMaintenancePhase` at complexity 152 on the task base. It combines foreground mailbox selection, idle housekeeping, delivery preparation, and checkpoint orchestration. Extract those three existing coherent operations with explicit inputs and outputs, leaving sequencing and checkpoint decisions in the current owner. No new store, retry, dependency, or generic framework is needed.

## Scope

Only workspace assistant phase source and this execution record. Existing composed phase tests cover fresh and pending input, exclusive causal selection, idle context/receipt handling, non-idempotent delivery deferral, and durable checkpoint callbacks.

## Risks and proof

Preserve the exact order of asynchronous operations and callback reads, including the pre-checkpoint pending-input recheck. Keep exclusive selection terminal on a missing candidate. Keep non-idempotent causal delivery deferred and all post-checkpoint closures bound to the final pending wake. Run the relevant composed phase suites, assistant-runtime typecheck, and complexity diff; inspect the diff for privacy and semantic equivalence. Real-model proof is not applicable because prompts, tools, reply policy, and provider inputs do not change.

## Tasks

1. Extract foreground selection, idle work, and dispatch preparation into private functions.
2. Run focused deterministic verification and inspect complexity deltas.
3. Close this record, commit, push, and open a complete draft PR for parent-owned review and ReviewGPT.

## Verification

- Passed four composed assistant-phase suites: foreground, scheduling, delivery, and device-sync; 279 tests total, one worker.
- Passed `MURPH_TSC_PACKAGE_CHECKERS=1 pnpm --filter @murphai/assistant-runtime typecheck` on final source.
- Passed `pnpm complexity:diff --base 91d301576fd7ca076e65ba09591f0fda4ae91d91`: maintenance function 152 to 119, file debt 334 to 304, file maximum 152 to 128. The selection helper remains 23 because its ordered causal fallback branches belong together; other new helpers are below 20.
- Diff review confirmed exclusive selection stays terminal on no match, pending-input occurrence cutoff and recheck order stay intact, and idle work preserves wake/result merging.
- Dispatch preparation in `callbacks.ts` only iterates the input effect array and passes scalar fields to the canonical outbox writer; it appends only to a new dispatch array. It cannot mutate the preparation or selected effect lengths used by the causal predicates after the helper returns.
- No member-visible change, provider-input change, new dependency, or deploy/schema contract change. Existing tests exercise the real phase with synthetic ports; no model invocation is required for function extraction.
- `scripts/frog list` reviewed after normal frozen dependency installation; no new repository workaround or Frog entry required.

## Handoff

Implementation complete. Parent owns candidate review, PR readiness, exact-head CI, and requested ReviewGPT. No merge or deploy performed.
Completed: 2026-09-11
