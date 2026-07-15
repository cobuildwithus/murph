# PR 550 Projection Cutover Barrier

## Goal

Prevent a delayed pre-cutover conversation turn from overwriting a newer
Settings projection when the projection field predates its causal watermark.

## Constraints

- Reuse the existing per-member mailbox causal counter as the cutover barrier.
- Apply the barrier only after the guarded old-Vercel-function drain.
- Preserve nullable field-local watermarks and the canonical vault as owner.
- Add no reconciliation service, historical reconstruction, or second state owner.
- This task forbids subagents; complete parent-owned reviews locally.

## Verification

- Migration contract tests and hosted web typecheck.
- Focused stale-turn projection tests.
- Final diff/privacy/architecture review.
- Guarded push, concurrent CI, and fresh exact-head ReviewGPT 0.5.106
  Pro/current.

Status: completed
Updated: 2026-07-14
Completed: 2026-07-14
