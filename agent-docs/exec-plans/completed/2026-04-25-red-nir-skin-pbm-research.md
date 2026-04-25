# Red/NIR Skin PBM Health Commons Research Landing

## Goal

Land the evidence-ready Health Commons family/protocol/source package for the red and near-infrared skin texture/photoaging starter variant.

## Scope

- Create the `skin-photobiomodulation` family page.
- Create the `red-near-infrared-skin-texture-photoaging` protocol variant page.
- Create the skin PBM source pages and artifact manifest from the validated research package.
- Create only missing biomarker pages included in the package.

## Constraints

- Preserve direct-vs-adjacent evidence boundaries from the research workflow.
- Preserve mixed/null evidence and safety QA fixes.
- Do not overwrite unrelated Health Commons content or generated catalog changes.
- Treat `packages/health-commons/generated/**` as shared landing output owned by active Health Commons lanes unless a scoped verification step explicitly requires local regeneration.

## Verification

- Validate the package source-key closure before landing.
- Run Health Commons generation/check commands where the shared dirty generated catalog allows truthful results.
- Run artifact dry-run because the artifact manifest changes.

## Status

In progress.
Status: completed
Updated: 2026-04-25
Completed: 2026-04-25
