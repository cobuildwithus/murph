# Preserve Junction menstrual and profile facts

Status: completed
Created: 2026-08-11
Updated: 2026-08-11

## Goal

- Preserve Junction's dated menstrual observations and its distinct profile gender value as structured, non-diagnostic facts.

## Success criteria

- Cervical mucus, intermenstrual bleeding, contraceptive records, sexual activity, and progesterone tests normalize as dated categorical measurements.
- Predicted records remain excluded and replay identities remain stable.
- Profile gender is queryable independently and is never substituted for biological sex.
- Focused importer/query coverage and package typechecks pass.

## Scope

- In scope: Junction menstrual/profile normalization, focused tests, compatibility documentation, and an accurate changelog disposition.
- Out of scope: predictions, diagnoses, inference, other providers, and unrelated audit findings.

## Constraints

- Technical constraints: reuse canonical measurement qualifiers and generic metric queries; add no new storage model or provider-specific query service.
- Product/process constraints: retain only provider-supplied categorical facts, preserve privacy boundaries, and keep the PR independently mergeable.

## Risks and mitigations

1. Risk: Categorical observations are mistaken for diagnoses or predictions.
   Mitigation: emit only dated source observations with neutral metric names and qualifiers; continue skipping predicted cycles.
2. Risk: Gender is relabeled as biological sex.
   Mitigation: preserve distinct metrics and explicit tests for both fields.

## Tasks

1. Apply and inspect the ReviewGPT implementation patch.
2. Simplify or correct the patch against repository ownership and current Junction enums.
3. Run focused tests and typechecks.
4. Commit, push, open the PR, and run ReviewGPT plus required CI gates.

## Decisions

- Use the existing canonical measurement event and qualifier structure for categorical dated facts.
- Keep gender separate from biological sex rather than adding a fallback or lossy alias.

## Verification

- `pnpm exec vitest run --config vitest.config.ts --no-coverage test/device-providers-junction.test.ts` — passed, 145 tests.
- `pnpm --filter @murphai/importers typecheck` — passed.
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/changelog-fragments.test.ts` — passed, 7 tests.
- `pnpm --filter @murphai/hosted-web typecheck` — passed.
- Confirmed supported observations and gender remain structured and replay-safe while predictions and absent values remain omitted.
Completed: 2026-08-11
