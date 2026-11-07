# Consolidate Family action dialog presentation

Status: completed
Created: 2026-09-14
Updated: 2026-09-14

## Outcome and invariant

Reduce the Family manager hotspot by deriving action dialog title, description, confirmation label and destructive styling together. Preserve exact consent and billing copy, supported actions, loading state, callbacks and request payloads.

## Design

Use one private pure switch on the existing PendingAction discriminant. Reuse current tier and price projections. Keep all state, event handlers, payment requests and dialog structure with the component. No new action state or workflow.

## Verification

Run existing Family manager interaction tests and Web typecheck, plus complexity and direct output equivalence over synthetic pending actions and tier combinations. Publish a scoped PR and run ReviewGPT concurrently with CI. No visible design or product contract change.

## Results

Family manager complexity 121 → 86; file debt 109 → 74. The private copy resolver stays below 20. All 30 existing Family manager interaction tests passed, as did Web typecheck.

An independent in-memory comparison evaluated the original title, description, confirmation label and destructive-style expressions against the new resolver across 336 synthetic action, ownership, recovery, tier and direction combinations. All outputs matched exactly. Existing loading text, callbacks, state and markup remain in place. Candidate diff/privacy review passed; ReviewGPT and exact-head CI remain external gates.
Completed: 2026-09-14
