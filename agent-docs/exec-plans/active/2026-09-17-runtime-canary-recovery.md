# Restore clinical progress across checkpoints and align canary observation

Status: active
Created: 2026-09-17
Updated: 2026-09-17

## Goal

- Resume unfinished clinical extraction when a checkpointed invocation accepts more work, and let the production canary observe the normal checkpoint window.

## Success criteria

- Regression proof fails on the base for continued extraction and normal delayed canary publication.
- Checkpoint-only returns do not restart extraction; foreground continuation preserves snapshot isolation and shutdown guards.
- Canary reply latency and canonical goal checks remain strict, and publication waits remain bounded.
- Focused tests, relevant typechecks, candidate review, exact-head CI, and ReviewGPT pass.

## Scope

- In scope: background read lifecycle at existing checkpoint/continuation boundaries, canary observation timing and workflow budget.
- Out of scope: new queues, schedulers, manual production restarts, canonical state changes, relaxed canary evidence.

## Constraints

- Keep canonical writes, claims, and checkpoint fences with their current owners.
- Use synthetic regression fixtures and metadata-only production investigation.
- Preserve foreground priority, terminal shutdown, and durable-effect ordering.

## Risks and mitigations

1. Resuming extraction too early can delay checkpoint effects or race snapshots.
   Mitigation: prove continuation and checkpoint-only return separately through the real runtime entrypoint.
2. Extending observation could conceal a true stall.
   Mitigation: derive the wait from the existing quiet-window contract plus a bounded publication allowance; retain timeout and canonical readback tests.

## Tasks

1. Reproduce both failures at their existing owners.
2. Correct continuation lifecycle and canary timing with the smallest changes.
3. Run focused regression and neighboring safety checks plus typechecks.
4. Review, document rollout behavior, commit, and open a reviewed green PR.

## Decisions

- Runtime checkpointing pauses clinical reads; continuing invocation paths do not resume them.
- Canary observation is five minutes while the shared default quiet window is ten minutes. Observation must remain independent of the twenty-second reply budget.
- No new persisted state or abstraction is needed.

## Verification

- Runtime clinical checkpoint entrypoint and controller suites, neighboring checkpoint/wake cases, and assistant-runtime typecheck.
- Web canary runner and outcome suites plus Web typecheck.
- Complexity and documentation drift checks, followed by exact-head CI and ReviewGPT.

## Product UX

- Effort: Patch. Existing members with an unfinished medical-record import can continue a conversation without leaving extraction paused.
- Journeys: post-checkpoint conversation continuation; checkpoint-only scheduled return; canonical canary publication after the normal quiet window; genuine publication timeout and invalid canonical goal evidence.
- Exclusions: no new replies, prompt changes, import completeness claims, or authority changes.
- Local walkthrough: Ready. The real runtime entrypoint resumes its controller only when continuing work; snapshot isolation and scheduled return tests pass. Canary evidence remains independent of reply latency.

## Evidence

- Before the source fix, the runtime continuation regression failed because extraction started only once; the canary regression failed before the normal quiet window elapsed.
- After correction, 59 focused runtime tests, 26 canary runner tests, 77 adjacent outcome/route tests, 10 changelog tests, and four workflow checks pass. Both regressions failed before their source fixes.
- Assistant-runtime and Web typechecks pass. The final continuation guard was rechecked through the runtime regression and both typechecks.
- Complexity passes with unchanged hotspot debt; the existing large orchestration owner does not need a new lifecycle abstraction for this correction.
- Adjacent Web observer suites initially required Prisma generation in the fresh checkout; the normal generation command completed successfully.
- Production recovery and a full production canary remain post-deployment proof, not claims from local tests.
