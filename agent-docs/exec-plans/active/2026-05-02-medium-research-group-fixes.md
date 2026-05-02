# Medium Research Group Fixes

## Goal

Group the remaining Health Commons research artifacts for these five protocols so `/research` can show complete grouped research cards instead of a flat source list:

- No added sugar
- Pneumatic compression pants
- Walking after every meal
- Red light skin/photoaging
- Red light glasses before bed

## Scope

Primary files:

- `packages/health-commons/content/protocols/added-sugar-reduction/no-added-sugar-diet.md`
- `packages/health-commons/content/protocols/intermittent-pneumatic-compression/pneumatic-compression-pants.md`
- `packages/health-commons/content/protocols/post-meal-walking/walking-after-every-meal.md`
- `packages/health-commons/content/protocols/skin-photobiomodulation/red-near-infrared-skin-texture-photoaging.md`
- `packages/health-commons/content/protocols/evening-light-reduction/red-light-glasses-before-bed.md`
- `packages/health-commons/content/evidence-appraisals/source-protocol-evidence/{added-sugar-reduction,post-meal-walking,skin-photobiomodulation,red-light-glasses-before-bed}.jsonl`
- new `packages/health-commons/content/evidence-appraisals/source-protocol-evidence/intermittent-pneumatic-compression.jsonl` if the protocol has no appraisal rows yet

## Constraints

- Keep grouping headers and summaries clean, human-readable, and consistent with the existing Finnish sauna grouped `/research` shape.
- Preserve adjacent modality boundaries: skin PBM stays separate from whole-body PBM, and red-light glasses stays separate from broader evening light reduction.
- Do not modify unrelated dirty Health Commons, hosted-web, or hosted-runtime work.
- Do not use placeholder group summaries.

## Verification

- Baseline and final completeness check for the five protocol `researchGroups` projections.
- `pnpm --dir packages/health-commons generate`
- `pnpm --dir packages/health-commons generate:check`
- `pnpm --dir packages/health-commons test:vitest` if generation succeeds.

## State

- Registered plan before content edits.
- Next: baseline missing grouped coverage and delegate disjoint protocol slices to subagents.
