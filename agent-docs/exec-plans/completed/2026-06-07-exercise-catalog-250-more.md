# Add 250 more at-home exercise catalog entries

Status: completed
Created: 2026-06-07
Updated: 2026-06-07

## Goal

- Add the supplied 250 at-home exercise rows to the exercise-library catalog,
  regenerate committed runtime artifacts, and prove the hosted runner bundle
  includes the expanded catalog.

## Success criteria

- The new CSV is committed under `packages/exercise-library/content/seed/`.
- `packages/exercise-library/generated/**` is regenerated from all seed CSVs.
- The hosted runner bundle proof reports the expanded exercise catalog item
  count.
- Required exercise-library verification passes.

## Scope

- In scope:
- Exercise-library seed CSVs and generated artifacts.
- Focused runner-bundle proof for the catalog shipped in the hosted runner
  container bundle.
- Out of scope:
- Rewriting exercise taxonomy, runtime search behavior, or unrelated workout
  capture flows.

## Constraints

- Technical constraints:
- Preserve existing CSV schema and generator path.
- Avoid leaking local import paths or personal identifiers into repo files.
- Product/process constraints:
- Preserve unrelated dirty work in the checkout.

## Risks and mitigations

1. Risk: The imported CSV uses a different numbered-list marker than the
   parser's existing seed format.
   Mitigation: Normalize list markers while preserving row text and validate
   through the generator.
2. Risk: Hosted bundle proof might require costly Docker verification.
   Mitigation: First use the existing runner bundle assembly/runtime artifact
   checks to prove the packaged generated catalog count; escalate only if that
   is not sufficient.

## Tasks

1. Add the new seed CSV without duplicate IDs or names.
2. Regenerate exercise-library artifacts.
3. Assemble or inspect the hosted runner bundle output and record the catalog
   item count inside the bundled package.
4. Run required package verification and completion audits.
5. Finish with a scoped commit.

## Decisions

- Use a separate seed file instead of appending to existing files, matching the
  package's existing multi-CSV default loader.
- Canonicalize target-area values to lowercase in the generator so generated
  target facets do not expose case-duplicate filters.

## Verification

- Commands to run:
  - `pnpm --dir packages/exercise-library generate`
  - `pnpm --dir packages/exercise-library test:coverage`
  - `pnpm typecheck`
  - Focused hosted runner bundle proof command, selected after inspecting the
    existing bundle scripts.
- Expected outcomes:
  - Exercise-library generated artifacts are current.
  - Exercise-library tests pass with coverage.
  - Typecheck passes or any unrelated failure is documented.
  - Bundled runner artifact includes the expanded catalog count.
- Current evidence:
  - `pnpm --dir packages/exercise-library generate` passed.
  - `pnpm --dir packages/exercise-library test:coverage` passed with 6 tests
    and coverage above thresholds.
  - `pnpm typecheck` passed.
  - `pnpm --dir apps/cloudflare runner:bundle` passed, and the assembled
    runner bundle's packaged exercise details artifact contains 1,750 items.
  - Direct facet proof shows zero case-insensitive duplicate target facets.
Completed: 2026-06-07
