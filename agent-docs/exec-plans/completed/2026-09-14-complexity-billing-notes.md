# Collapse scheduled billing plan note branches

Status: completed
Created: 2026-09-14
Updated: 2026-09-14

## Outcome and invariant

Reduce the billing settings hotspot by expressing scheduled plan notes through one private renderer. Preserve all current supported transitions, Family warnings, dates, plan labels, controls and markup. This is an internal refactor with no pricing, authorization or member-facing behavior change.

## Design

Derive one formatted scheduled date and reuse the existing plan definitions and PendingPlanChangeNote component. Each card explicitly lists its current supported transitions; do not introduce new transitions. Keep Family-specific warnings at their existing precedence. Remove repeated per-plan scheduling flags and deeply nested rendering branches.

## Verification

Existing billing settings rendering and interaction tests, an exhaustive synthetic base/head render comparison, Web typecheck, complexity and diff review. Open a scoped PR and start ReviewGPT alongside exact-head CI. No changelog or design-system change for identical presentation.

## Results

Billing component complexity 128 → 91; file debt 140 → 103. The private note renderer remains below 20, and the implementation removes 42 net lines.

All 69 existing billing settings tests passed. A temporary comparison also rendered the base and candidate with 2,400 synthetic combinations (current/scheduled plans, Family states, billing status, billing phase, date presence and visibility flags); exact static markup matched in every case. The temporary base implementation and comparison were removed after proof. Web typecheck passed. Candidate review confirmed the explicit transition lists preserve the original omissions and Family warning precedence. ReviewGPT and exact-head CI remain external gates.
Completed: 2026-09-14
