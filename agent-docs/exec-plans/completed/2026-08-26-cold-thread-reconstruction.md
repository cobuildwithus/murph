# Deepen cold assistant conversation reconstruction

Status: completed
Created: 2026-08-26
Updated: 2026-08-26

## Goal

- Preserve enough recent committed conversation context for Murph to understand ordinary follow-up requests when native Codex thread resume is unavailable, without introducing another session owner or unbounded prompt growth.

## Product UX

- Effort: Patch.
- Outcome: An established member can refer to a recent prior exchange after a cold start and Murph can continue it instead of asking what they mean.
- Reaches: Existing committed-history cold-turn reconstruction; warm native resume remains unchanged.
- Proof: Deterministic history-selection tests cover the deeper count and byte bounds, and one focused real-Codex journey reviews the reconstructed follow-up reply.

## Architecture and evidence

- Current owner: Assistant Engine's committed transcript projection is already the documented recovery owner when native resume is unavailable.
- Proven gap: A production cold turn exhausted the 24-entry limit while using materially less than the existing 12,000-byte ceiling, omitting a still-retained exchange needed by the next request.
- Smallest correction: Apply one shared 72-entry policy to the existing bounded projection while preserving its 12,000-byte ceiling. Do not add route-specific branching, a second provider-thread registry, deployment migration, session selector, or persisted state.
- Protected invariants: Native resume remains authoritative; cold replay stays incomplete-aware, retention-bounded, privacy-safe, and capped by both entry count and UTF-8 bytes.

## Tasks

1. Trace native-resume eligibility, scheduled-turn isolation, transcript selection, and current prompt-cost instrumentation.
2. Add deterministic regressions for the intended deeper cold-history window and unchanged incompleteness behavior.
3. Implement the smallest bounded limit change and update its durable owner documentation when needed.
4. Run focused deterministic proof, provider-input measurement, and the required focused real-Codex journey; review the actual reply.
5. Complete Product UX walkthrough, changelog, exact-head PR review gates, CI, merge, deployment proof when applicable, and guarded worktree retirement.

## Risks and mitigations

1. Risk: Larger reconstruction increases cold-turn input cost and latency.
   Mitigation: Measure the exact maximum and representative provider-visible delta; retain a hard byte ceiling and change no warm-resume request.
2. Risk: More history crowds out current instructions or retains content longer.
   Mitigation: Reuse only already-retained transcript entries, preserve per-message and total-byte bounds, and leave source retention unchanged.
3. Risk: A deeper replay could expose orphaned or misleading assistant output.
   Mitigation: Preserve the existing leading-orphan cleanup and incomplete-history marker, with focused regression proof.
4. Risk: Session-retention changes create competing continuity owners.
   Mitigation: Reject new session state unless code-path evidence proves the existing transcript owner cannot satisfy the outcome.

## Verification

- PASS: Assistant Engine planner file, 98/98 tests, including sixty-message reconstruction and shared byte bounds.
- PASS: Assistant Engine package typecheck.
- PASS: Hosted Web changelog page, 9/9 focused tests.
- PASS: Agent docs drift checks.
- HOLD: The focused `pnpm test:assistant:live` journey now seeds a normal saved session and enters the production local message service, but the subscription provider rejected the turn before a reply because its usage allowance is exhausted until 2026-09-01.
- Exact-head required GitHub Actions, preliminary Product UX and coverage specialist lenses, final cross-cutting ReviewGPT gate, parent final review, and current-base merge-tree proof.
Completed: 2026-08-26
