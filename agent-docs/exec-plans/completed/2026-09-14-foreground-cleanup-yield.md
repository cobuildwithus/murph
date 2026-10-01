# Yield provider cleanup to foreground messages

Status: completed
Created: 2026-09-14
Updated: 2026-09-14

## Goal

- Let fresh conversation input release a runtime pass blocked on provider cleanup so the next assistant request starts sooner.

## Success criteria

- A held provider delete aborts when the existing foreground-work predicate becomes true.
- Unconfirmed deletes retain their current durable queue and future retry wake; successful deletes and required state commits retain their existing semantics.
- Focused tests, typecheck, candidate review, routed ReviewGPT, and exact-head PR checks complete.

## Scope

- In scope: request-local cleanup cancellation and budget, retry proof, the runtime handoff regression, and the durable protocol description.
- Out of scope: typing placement, assistant prompts or tools, new queues, deployment, and unrelated wake diagnostics.

## Constraints

- Technical constraints: keep the shared maintenance signal unmodified; await the cancelled request before persisting retry state. Existing cleanup JSON remains the only durable owner.
- Product/process constraints: use synthetic proof and preserve quiet paths, current delivery authority, and canonical commit safety.

## Product UX

- Outcome: reduce waiting before the next assistant turn when cleanup is already running.
- Reaches: existing private and group runtime conversations; empty/system-only wakes preserve ordinary cleanup.
- Proof: held-HTTP foreground handoff, bounded idle request, normal success, abort/retry, and unchanged canonical maintenance signal.

## Risks and mitigations

1. A delete can succeed remotely while its response is cancelled.
   Mitigation: retain the unconfirmed id; existing idempotent DELETE/404 handling makes the later retry safe.
2. Broad cancellation could interrupt state commits.
   Mitigation: create the cancellation controller inside one provider request; no shared runner signal is cancelled.

## Tasks

1. Bound each cleanup request to one second and observe the existing yield predicate every 25 ms while it is in flight.
2. Treat local interruption as deferral, preserve the queue, and cover resumed cleanup.
3. Prove composed runtime handoff using the real cleanup/HTTP path.
4. Update owner documentation and the member-facing changelog, verify, review, and open the PR.

## Decisions

- Reuse the existing yield predicate rather than add another runner signal or scheduler.
- The reproduced gap is that the old drain observes foreground input only between deletes; the new request observes it during the await.
- No schema or protocol migration: old and new runtimes read the same retry file; rollout changes only local execution timing.

## Verification

- Commands: focused provider-cleanup and workspace-runner tests; assistant-runtime typecheck; complexity guard; focused changelog validation.
- Expected outcomes: a held request yields, required commits remain protected, retained ids retry successfully, and no typing or provider-input surface changes.

## Implementation result

- Focused provider-cleanup and workspace-runner tests passed: 30 tests, including real runner-to-HTTP interruption and durable retry.
- Assistant-runtime and Web typechecks passed; changelog render tests passed (10); complexity debt and maximum are unchanged; diff whitespace checks passed.
- Parent candidate review completed. ReviewGPT round 1 passed on `a07ef0b4a07c1cc264de38260ab5617564582d8f` with no qualifying findings.
- PR #3451 owns final CI and mergeability evidence. The implementation is complete; no deployment or merge was performed. This closure changes documentation only.
Completed: 2026-09-14
