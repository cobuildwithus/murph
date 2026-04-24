# Land Morning Outdoor Light Exposure Health Commons package

Status: completed
Created: 2026-04-24
Updated: 2026-04-24

## Goal

- Land the evidence-ready Morning Outdoor Light Exposure Health Commons content package generated from the completed research workspace.

## Success criteria

- The page-builder package is applied to tracked Health Commons authored content without overwriting unrelated work.
- The protocol/family/source/biomarker/artifact files parse through the Health Commons catalog builder.
- Claims remain source-keyed, safety language stays conservative, and outdoor morning light remains separate from light boxes, dawn simulators, SAD/depression light therapy, exercise bundles, and evening light protocols.
- Browser-thread follow-up sends, if needed, are distributed to the lowest-load managed browser lane instead of crowding `hercules`.
- Verification results and any scoped blockers are recorded before handoff.

## Scope

- In scope:
  - `output-packages/research/morning-outdoor-light-exposure/**`
  - `packages/health-commons/content/families/morning-light-exposure.md`
  - `packages/health-commons/content/protocols/morning-light-exposure/**`
  - `packages/health-commons/content/sources/morning-light-exposure/**`
  - `packages/health-commons/content/artifacts/morning-light-exposure/**`
  - `packages/health-commons/content/biomarkers/sleep-quality.md`
  - Directly required generated Health Commons catalog outputs only if landing validation requires them
  - This active plan and its coordination-ledger row
- Out of scope:
  - Health Commons runtime/tooling work
  - Other active protocol research packages
  - Hosted web UI changes
  - Personal medical advice or diagnosis

## Constraints

- Preserve unrelated dirty-tree work.
- Do not touch active Health Commons runtime/tooling files owned by the assistant-access lane.
- Keep generated research metadata path-relative and free of local personal identifiers.
- Do not fabricate source identifiers, study details, effect sizes, or safety events.
- Prefer lower-load browser profiles for any remaining review:gpt sends.

## Risks and mitigations

1. Risk: The package is large and could overlap with other Health Commons content work.
   Mitigation: Land only the morning-light authored content subtree and the one missing biomarker page; avoid shared generated files unless validation requires them.
2. Risk: Morning outdoor light can be confused with clinical light therapy or exercise.
   Mitigation: Preserve explicit boundaries and conservative safety/stop conditions.
3. Risk: Generated source pages may include schema drift from the page-builder.
   Mitigation: Run Health Commons parse/generate checks and inspect failures before committing.

## Tasks

1. [x] Harvest and validate all section synthesis seams.
2. [x] Harvest the page-builder package.
3. [x] Register the landing lane.
4. [x] Apply the returned content package to tracked authored content.
5. [x] Run Health Commons validation/generation checks.
6. [x] Run required repo verification or document scoped blockers.
7. [x] Run required completion workflow and commit if safe.

## Decisions

- Use the existing `morning-outdoor-light-exposure` workspace as the evidence source.
- Treat the page-builder zip package as implementation intent, not overwrite authority.
- Include generated Health Commons catalog outputs because `generate:check` required them after the content landing.
- Deduplicate pre-existing shared source keys by keeping the global existing source page and adding morning-light protocol appraisals/relations there.

## Verification

- Page-builder validation report passed before landing.
- `pnpm --filter @murphai/health-commons generate:check` passed.
- `pnpm --filter @murphai/health-commons test` passed: 8 files, 20 tests.
- `pnpm --filter @murphai/health-commons typecheck` passed.
- `git diff --check` on touched paths passed.
- Privacy scan on touched skills, content, and generated Health Commons artifacts passed.
- Required completion review found stale `.md` slugs, stale batch group IDs, and pre-dedupe source-count text; all were fixed and the focused re-review returned no remaining findings.
- Post-review fixes rechecked with `pnpm --filter @murphai/health-commons generate:check`, `pnpm --filter @murphai/health-commons test`, `pnpm --filter @murphai/health-commons typecheck`, `git diff --check`, privacy scan, and local catalog scripts (`mdSlugs: 0`, `stale: 0`, `categorized: 270`, `appraised: 45`).
- `pnpm typecheck` is blocked outside this landing by `packages/assistant-engine` test type error: `test/assistant-cli-tools-capabilities.test.ts(1135,12): 'protocols' is of type 'unknown'`.
Completed: 2026-04-24
