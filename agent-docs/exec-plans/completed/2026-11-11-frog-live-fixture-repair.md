# Repair live journey fixture preconditions

Status: completed
Created: 2026-11-11
Updated: 2026-11-11

## Goal

Make live fixture failures distinguishable from assistant regressions for Frog reports #4844 and #4386.

## Scope and protected behavior

Repair test dates, hosted permission fixture preparation, and benchmark prerequisites only where current evidence proves a defect. Preserve production prompts, exact writes, privacy, and sandbox boundaries. Keep model comparison sampling guidance with the verification owner.

## Implementation outcome

Diagnosis, bounded fixture corrections, and local proof are complete. The scoped PR retains external ReviewGPT and exact-head CI as completion gates; shared policy changes await human merge authorization. Neither report is closed by this implementation record.

The committed reports match the trusted bot issues: #4844 is the live-journey-pass report and #4386 is the live-suite-fixtures report. The repair preserves all model outcome assertions and adds no production behavior.

## Evidence and decisions

- The symptom-save journey hard-codes May 18 in the prompt and Journal assertion while Codex supplies the current date; use one captured instant and its New York date.
- The unchanged ten-player permission fixture passes the current native journey. No speculative permission change is included.
- The meal benchmark now checks selected image hashes and a bounded loopback food-label read before any selected live journey. Its historical image retrieval recipe remains unavailable; early prerequisite failure satisfies the report’s alternative requirement without invented corpus data.
- Balanced interleaved comparisons prevent separate batches from being mistaken for causal regression evidence.

## Verification

- Existing provider-key configuration unit check passed before edits.
- Live-runner parser regression failed before the narrow workspace-prefix correction; all 16 runner tests pass afterward. A scoped Frog entry records this additional proven prerequisite defect.
- Composed Vitest preflight test passes six selection/admission scenarios: ordinary-only, missing environment, failed labels read, missing image, corrupt image, and valid loopback response. No simulated provider callback runs for failed prerequisites.
- Actual suite selection of one benchmark and the ten-player journey fails at the prerequisite hook with zero recorded provider requests and no game callback.
- Focused real-Codex symptom journey passes with one saved fact, same-ID readback, current Journal date, and no duplicate. The unchanged ten-player journey passes its exact one-send, lore-write, and privacy assertions. Both used gpt-6.1-sol and local subscription auth with ambient configuration; reviewed replies are Ready for their fixture claims.
- Assistant Engine and repo tools typechecks pass; complexity, docs drift, and gardening pass.
- Morning reconciliation passes unchanged: four intended repairs, seven preserved records, quiet responses, and zero additional repairs on a repeat. This is one sample, not a pass-rate guarantee; no behavioral assertions have been relaxed.
- Required ReviewGPT is currently blocked by signed-out managed browser capacity verified by the coordinator. No review submission or PASS is claimed. Shared verification guidance requires human merge authorization.
Completed: 2026-11-11
