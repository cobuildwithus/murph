# PR 521 ReviewGPT Round 5

## Goal

Close the two exact-head ReviewGPT findings without adding another repair mode:
canonical reconciliation owns event state, while evidence association is derived
per output from equivalent or newly appended canonical owners.

## Invariants

- Protected, edited, deleted, newer, or ambiguous event owners are never linked
  to stale evidence.
- Partial or integrity-invalid exact deliveries repair once with complete evidence,
  without mutating or associating protected event owners.
- A complete valid delivery remains a storage no-op.
- Repair identities remain deterministic and append-only.

## Work

1. Collapse batch-global association repair branching into one reconciliation flow.
2. Derive evidence/event outputs from per-prepared-event association eligibility.
3. Align the durable device-ingest invariant with exact versus later-attempt replay behavior.
4. Add focused delayed-attempt and damaged-row regressions.
5. Run scoped tests, typecheck, completion audits, and exact-head ReviewGPT.

## Verification

- `pnpm --filter @murphai/core exec vitest run test/device-import.test.ts`
- `pnpm --filter @murphai/core typecheck`
- Required coverage/security/completion audits for the final diff
- Exact-head ReviewGPT completion marker and model verification
Status: completed
Updated: 2026-07-12
Completed: 2026-07-12
