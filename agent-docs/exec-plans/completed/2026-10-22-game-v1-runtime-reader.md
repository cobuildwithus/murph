# Game v1 runtime reader floor

## Outcome and invariant

Prepare hosted game readers for additive v1 values before Web emits them. Legacy requests and responses must parse unchanged; strict privacy boundaries remain intact.

## Owner and evidence

The existing Zod schemas in `packages/hosted-execution/src/game-tools.ts` reject prize/dare, any, and lengths or progress above 28. Extend that owner only. No state, database, model-facing schema, prompt, or provider input changes.

## Implementation

Widen existing enums and bounded numeric/array limits to 365. Keep legacy values and minimum 1 for existing rows. Add compatibility coverage for request, pending proposal, terms, state and progress; reject 366 and unknown values. No abstraction is needed.

## Rollout

Merge this reader release, deploy Web, then deploy the protected Cloudflare runtime with warm-runtime replacement. New readers accept old producers. Old readers must not receive v1 output: the rules writer PR remains blocked until managed-container fingerprint and native rollout convergence are proven. This reader becomes the floor once new writers ship. No rollback is authorized.

## Proof and gates

- Focused game compatibility tests and hosted-execution typecheck.
- Complexity, raw log and docs drift guards.
- Parent diff review, requested read-only Codex deep review and ReviewGPT on the stable pushed head concurrently with required CI.
- Exact-head CI, mergeability, merge, Vercel admission/health/exact deployment proof.
- Protected runtime deployment and warm-runtime convergence evidence in the PR comment and shared lane status.

## Progress

- Reader widening and boundary tests implemented. All 19 focused compatibility tests pass; hosted-execution typecheck and incremental workspace build pass. Complexity reports zero hotspots; log and docs drift guards pass.
- Parent candidate review confirms only additive acceptance, no model-facing schema or description changes, no new calls or state.
- Implementation plan closed for the stable candidate. Required external review, exact-head CI, merge and production convergence remain release gates tracked in the PR and shared lane status; they are not claimed complete here.
- Changelog not applicable: internal reader preparation only; no writer or member-facing behavior changes.
Status: completed
Updated: 2026-10-22
Completed: 2026-10-22
