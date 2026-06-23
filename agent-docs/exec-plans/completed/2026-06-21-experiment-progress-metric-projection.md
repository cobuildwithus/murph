# Experiment Progress Metric Projection

## Goal

Fix experiment progress, outcome analysis, and progress-card generation so they use the existing query metric projection for metric rows while keeping experiment/session records on the normal projected entity read model.

## Scope

- `packages/query/src/experiments.ts`
- `packages/query/src/experiment-progress-card.ts`
- `packages/vault-usecases/src/usecases/experiment-journal-vault.ts`
- Focused tests covering metric projection rows feeding experiment progress/card results

## Constraints

- Keep the architecture simple: no new persisted state, provider-specific branching, or raw-vault fallback on the normal progress path.
- Preserve the default sparse `readVault()` entity read model.
- Keep sleep-onset latency unsupported/missing when no metric points exist.

## Verification

- Add a failing regression first.
- Run focused package tests, then scoped repo verification required for the touched packages.
Status: completed
Updated: 2026-06-21
Completed: 2026-06-21
