# Finnish Sauna Research Groups

## Goal

Make the Finnish sauna experiment research tab use grouped article sections like Norwegian 4x4, with simple section copy backed by the Health Commons source/appraisal data.

## Scope

- Source protocol Markdown: `packages/health-commons/content/protocols/dry-sauna/murph-finnish-standard-3x-week.md`
- Finnish dry-sauna source appraisal rows: `packages/health-commons/content/evidence-appraisals/source-protocol-evidence/dry-sauna.jsonl`
- Focused generation/tests only where needed to prove the grouping projection.

## Constraints

- Preserve unrelated dirty work in `apps/web`, Cloudflare, hosted runtime, and other active Health Commons rows.
- Prefer content-data correction over UI exceptions.
- Do not write generated artifacts unless required by repo verification.

## Current Read

- The protocol Markdown already has a `researchLandscape` block, but the web projection hides grouped research unless every grouped source has matching appraisal coverage.
- The dry-sauna appraisal file has separate target rows for Bryan Johnson Blueprint and Murph Finnish sauna; only the Finnish target rows should drive this fix.

## Verification Target

- Finnish sauna generated research data should expose non-empty `researchGroups`.
- Focused Health Commons/web checks should pass or report unrelated blockers.
