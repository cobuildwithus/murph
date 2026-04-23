# Align document promotion imports with override-aware canonical metadata

Status: completed
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Make document promotion writes use the same resolved `occurredAt`, `note`, and `source` metadata already used for canonical matching.
- Preserve idempotent retries when promotion overrides are supplied.

## Why

- `promoteCanonicalAttachmentImport()` already resolves override-aware canonical metadata before checking existing canonical imports.
- The document promotion write path still calls `importDocument()` with raw capture metadata (`capture.occurredAt`, `capture.text`, and `'import'`), so the first canonical write can diverge from the metadata used for reconciliation.
- That divergence can make retries or equivalent promotions miss the existing canonical import and either create duplicates or fail with missing-canonical-state errors.

## Scope

- `packages/inbox-services/src/inbox-services/promotions.ts`
- `packages/inbox-services/src/inbox-app/promotions.ts`
- directly coupled `packages/inbox-services/test/promotions-seam.test.ts`
- `agent-docs/exec-plans/active/{2026-04-23-inbox-services-document-promotion-metadata.md,COORDINATION_LEDGER.md}`

## Out of scope

- broader inbox promotion redesign
- non-document promotion behavior changes beyond the shared helper contract needed to pass resolved metadata through
- unrelated `packages/inbox-services` cleanup already active elsewhere in the worktree

## Constraints

- Keep the change additive and narrow to the document promotion metadata seam.
- Preserve the existing meal behavior and the current promotion-store reconciliation flow.
- Reuse the single resolved metadata object instead of re-deriving document metadata in multiple places.
- Coordinate with the broad assertion-cleanup row that includes `packages/inbox-services/**`, but stay isolated to these promotion files and tests.

## Risks and mitigations

1. Risk: Changing the shared helper signature could unintentionally affect meal promotion behavior.
   Mitigation: Pass the resolved metadata through generically, leave meal semantics unchanged, and add regression coverage around both the shared helper contract and app-level document promotion behavior.
2. Risk: Dirty-tree overlap could cause an unsafe commit.
   Mitigation: Limit edits to the declared files, use focused verification, and only create a scoped commit if exact staging remains clean.

## Tasks

1. Register the active ledger row and inspect the current promotion helper/document tests.
2. Thread resolved canonical metadata through `promoteCanonicalAttachmentImport()` into the document `createPromotion()` path.
3. Update app-level document promotion to use that resolved metadata for `importDocument()`.
4. Add regression tests covering override-aware document creation and retry reconciliation.
5. Run truthful `packages/inbox-services` verification, required audits, and land a scoped commit if exact staging is safe.

## Verification

- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff packages/inbox-services/src/inbox-app/promotions.ts packages/inbox-services/src/inbox-services/promotions.ts packages/inbox-services/test/promotions-seam.test.ts`
- `pnpm test:smoke`
- `pnpm --dir packages/inbox-services exec vitest run --config vitest.config.ts test/promotions-seam.test.ts`
- `pnpm --dir packages/inbox-services test:coverage`
- Direct proof:
  - document promotion with override metadata writes those exact `occurredAt`, `note`, and `source` values
  - a retry with the same override metadata reconciles to the existing canonical document instead of creating a duplicate

## Outcome

- Shared helper metadata now flows into document `createPromotion()` calls.
- App-level document promotion now passes resolved override-aware metadata into `importDocument()`.
- Regression coverage now proves helper metadata handoff, default document import provenance, override-aware document writes, and retry reconciliation.
- `pnpm --dir packages/inbox-services exec vitest run --config vitest.config.ts test/promotions-seam.test.ts` passed.
- `pnpm --dir packages/inbox-services test:coverage` passed.
- `pnpm test:smoke` passed.
- `pnpm typecheck` and the scoped `workspace-verify test:diff ...` lane remain blocked by unrelated pre-existing failures in `packages/core/src/history/api.ts` and `packages/vault-usecases/src/vault-services.ts`.
- `pnpm --dir packages/inbox-services typecheck` remains blocked by the existing package-local `tsconfig.typecheck.json` module-resolution gap for `@murphai/core`.
