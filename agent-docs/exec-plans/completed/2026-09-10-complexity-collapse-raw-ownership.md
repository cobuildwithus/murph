# Collapse raw asset ownership parsing complexity

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Goal and protected invariant

Reduce repeated branches in core raw asset ownership inference while preserving
all accepted and rejected directory layouts, normalized path behavior, schema
validation, artifact names, and manifest ownership checks.

## Owner and evidence

`packages/core/src/raw.ts` already owns finite owner root definitions and the
partitioned owner set. Its inference function repeats the same root, depth,
year/month, and schema checks for nine layouts (cyclomatic complexity 37).
Reuse those definitions with the contracts-owned finite owner kinds and one
structural check. Preserve the existing digit-width date check and generic
contract ID validation; this refactor adds no format restrictions.

## Scope and constraints

- Change raw directory inference and focused raw owner tests only.
- No new persisted state, API, schema, dependencies, or product behavior.
- Keep normalization and schema validation as their existing authorities.
- Internal-only change; no changelog or provider-input measurement applies.
- Parent owns final candidate review, ReviewGPT routing, and exact-head CI.

## Tasks

1. Characterize all nine owner layouts, normalization, malformed paths, and
   owner mismatches using synthetic data against the existing implementation.
2. Collapse repeated branches through existing owner definitions.
3. Run focused raw owner, manifest, and experiment repair tests; core typecheck;
   and the Cyclomatic Complexity Guard. Review privacy and the complete diff.
4. Close this plan, make a scoped neutral-author commit, and open a draft PR.

## Verification

- Baseline characterization: all 50 tests in `raw-owner-model.test.ts` pass
  against the original implementation.
- Final focused proof: `pnpm exec vitest run --config
  packages/core/vitest.config.ts --no-coverage --maxWorkers=1
  packages/core/test/raw-owner-model.test.ts
  packages/core/test/raw-manifest-idempotency.test.ts
  packages/core/test/experiment-media-repair.test.ts` passes: 3 files, 72 tests.
- `pnpm --dir packages/core typecheck` passes.
- `pnpm complexity:diff --base b2a559812972d70644cffb2bf43923fc9211047d
  -- packages/core/src/raw.ts` passes: function/file maximum 37 to 8,
  complexity debt 17 to 0, no remaining changed-file hotspot above 20.
- Source change: 20 added and 110 deleted lines (90 net lines removed).
- Full candidate diff, privacy, and `git diff --check` reviewed successfully.
- No new repository friction found; existing Frog inventory reviewed.

## Completion handoff

Implementation and local verification are complete. The draft PR remains under
the parent session's candidate review, final ReviewGPT routing, and exact-head
CI ownership. The existing canonical layout and schema contract is unchanged,
so no durable architecture or contract owner update is needed.

## Risks and mitigation

Workouts share a root for singleton and batch owners. Match partition shape
alongside the root, and test both layouts and wrong owner metadata. Preserve
normalized relative path behavior, digit-width dates, and schema failure results.
Completed: 2026-09-10
