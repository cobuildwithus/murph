# Standardize write-side relationship persistence around canonical links

Status: completed
Created: 2026-04-07
Updated: 2026-04-07

## Goal

- Make write-time relation persistence use canonical `links[]` across relation-bearing bank/health families and event records while keeping the old family-specific arrays and `relatedIds[]` as compatibility projections.

## Success criteria

- Contracts accept persisted `links[]` for relation-bearing frontmatter and event records without breaking old array-based inputs.
- Core writers emit canonical `links[]` plus compatibility arrays for relation-bearing bank/health families and event records.
- Query-side registry extraction understands persisted `links[]` and recipe/protocol relations project through the intended semantic vocabulary.
- Focused contracts/core/query regressions pass, plus required repo verification for the touched package lanes.

## Scope

- In scope:
- `packages/contracts` relation schemas, registry extraction helpers, and event/frontmatter/upsert payload contracts
- `packages/core` bank/family/genetics/event mutation writers that own persisted record shapes
- `packages/query` registry projection tests and any minimal projection adjustments required by the new write shape
- Out of scope:
- Broad graph/read-model redesign beyond the existing query projection seam
- File-layout changes under `vault/**`
- Unrelated hosted, inbox, or gateway refactors

## Constraints

- Technical constraints:
- Keep family-specific arrays such as `relatedGoalIds`, `relatedConditionIds`, `relatedVariantIds`, `sourceFamilyMemberIds`, and event `relatedIds` as outward compatibility projections for now.
- Preserve existing id validation and dedupe behavior; the new `links[]` path must fail closed on invalid relation types or target ids.
- Product/process constraints:
- Preserve unrelated dirty-tree edits.
- Follow the standard repo verification and required completion review flow.

## Risks and mitigations

1. Risk: Adding `links[]` to strict contracts could break existing round-trip readers or fixtures.
   Mitigation: Teach registry extraction to merge canonical `links[]` with legacy arrays, then keep tests covering both shapes.
2. Risk: Relation vocab could diverge again between recipes and protocols.
   Mitigation: Move recipes onto the same semantic goal/condition relation types that protocols already use.
3. Risk: Event records could grow a second unsynchronized relation path.
   Mitigation: Derive `relatedIds[]` from canonical event `links[]` inside the mutation builder and persist both from one normalization step.

## Tasks

1. Add shared relation-link schemas/helpers in contracts and extend frontmatter, upsert payload, and event contracts to accept canonical `links[]`.
2. Update registry relation extraction to honor canonical `links[]` while preserving legacy array compatibility, and align recipe relation vocab with protocol semantics.
3. Update core writers/readers to canonicalize relation inputs into `links[]` plus compatibility projections for recipes, protocols, existing relation-bearing families, and event records.
4. Expand focused tests, run required verification, perform the required completion review, and finish with a scoped commit.

## Decisions

- Persist `links[]` additively first; do not hard-cut the legacy arrays in this pass.
- Treat `supports_goal`, `addresses_condition`, and `source_family_member` as the canonical semantic vocab for those relation families; keep other existing relation types where they still convey distinct meaning.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test:packages`
- `pnpm test:smoke`
- Expected outcomes:
- Contracts/core/query relation schemas, writers, and projections accept canonical `links[]` while preserving legacy compatibility projections.
- Actual outcomes so far:
- `pnpm --dir packages/contracts generate` passed and regenerated schema artifacts for the touched write-side shapes.
- `pnpm typecheck --filter @murphai/core` remains blocked by pre-existing unrelated errors in `packages/core/src/mutations.ts`, `packages/core/src/vault.ts`, and `packages/assistant-engine/src/usecases/workout-model.ts`; no remaining type errors were reported in the touched relation files.
- `pnpm test:packages` remains blocked by the same pre-existing repo type failures before the package suites complete.
- `pnpm test:smoke` passed.
- `pnpm --dir packages/query exec vitest run --config vitest.config.ts --no-coverage test/health-registry-definitions.test.ts test/query.test.ts` passed.
- `pnpm --dir packages/core exec vitest run --config vitest.config.ts --no-coverage test/canonical-mutations-boundary.test.ts test/health-bank.test.ts` passed.
- `pnpm --dir packages/core exec vitest run --config vitest.config.ts --no-coverage test/canonical-mutations-boundary.test.ts test/core.test.ts test/health-bank.test.ts` is blocked by one unrelated pre-existing failure in `test/core.test.ts` (`mediaBuffer` is undefined in `validateVault accepts workout and body-measurement media references`).
- Required `simplify` audit pass ran. The actionable drift finding on duplicated event relation canonicalization was fixed by extracting shared logic into `packages/core/src/event-links.ts`.
- Required final review ran. Follow-up fixes landed for legacy `relatedIds` dedupe in the mutation path and for explicit `links: []` authority in registry extraction/projected reads.
- Post-review reruns passed:
- `pnpm --dir packages/core exec vitest run --config vitest.config.ts --no-coverage test/canonical-mutations-boundary.test.ts test/health-bank.test.ts`
- `pnpm --dir packages/query exec vitest run --config vitest.config.ts --no-coverage test/health-registry-definitions.test.ts test/query.test.ts`
Completed: 2026-04-07
