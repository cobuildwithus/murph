# Query Read-Model Convergence

## Goal

Land section 2 of `docs/architecture-review-2026-04-01.md` by making `CanonicalEntity` the authoritative generic query read-model shape and keeping `VaultRecord` as a compatibility adapter.

## Why

- `packages/query/src/model.ts` currently owns both the canonical entity shape and the legacy `VaultRecord` vocabulary.
- `createVaultReadModel()` still treats `records` as authoritative and derives `entities`, which keeps the compatibility shape as a second owner.
- The architecture review called out this exact duplication as the next bounded cleanup.

## Scope

- `packages/query/src/model.ts`
- new read-model adapter module if needed
- focused `packages/query/test/query.test.ts`
- focused `packages/query/test/health-tail.test.ts`

## Constraints

- Preserve the existing public `VaultRecord` / `VaultReadModel` API for downstream callers.
- Keep behavior stable for timeline, search, export-pack, and health projections.
- Do not widen into package-boundary or product-behavior changes outside `packages/query`.

## Verification

- `pnpm --dir packages/query typecheck`
- focused `packages/query` Vitest runs for the touched seam
- broader root `pnpm typecheck`

## Status

- Implemented `CanonicalEntity`-first read-model ownership in `packages/query/src/model.ts`.
- Added `packages/query/src/vault-record-adapter.ts` for explicit compatibility conversions.
- Preserved legacy null-kind fallback semantics at the adapter boundary so timeline/search helpers keep their existing behavior.
- Preserved manual `VaultRecord.sourceFile` compatibility via read-model projection metadata after the completion audit surfaced the regression.
- Added a focused canonical-entity input regression test in `packages/query/test/query.test.ts`.
- Added a focused manual `sourceFile` preservation regression test in `packages/query/test/query.test.ts`.

## Verification Outcomes

- `pnpm --dir packages/query typecheck` passed.
- `pnpm exec vitest run --no-coverage packages/query/test/query.test.ts packages/query/test/health-tail.test.ts` passed.
- Post-audit rerun: `pnpm --dir packages/query typecheck` passed.
- Post-audit rerun: `pnpm exec vitest run --no-coverage packages/query/test/query.test.ts packages/query/test/health-tail.test.ts` passed.
- `pnpm test:smoke` passed.
- Completion audit (`task-finish-review`) found one medium compatibility regression around manual `sourceFile` round-tripping; fixed locally and re-verified.
- `pnpm typecheck` is red for an unrelated pre-existing `apps/web` failure in `apps/web/test/hosted-onboarding-webhook-idempotency.test.ts` where a mocked `$queryRaw` no longer satisfies Prisma's `PrismaPromise<T>` signature.
- `pnpm test:packages` is red for an unrelated pre-existing `packages/cli/test/assistant-runtime.test.ts` failure set around post-delivery assistant session persistence / `providerSessionId`.

## Commit Plan

- Use `scripts/finish-task` while this plan stays active so the completed plan artifact is committed with the scoped diff.
Status: completed
Updated: 2026-04-02
Completed: 2026-04-02
