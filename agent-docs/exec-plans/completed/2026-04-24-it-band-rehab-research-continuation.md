# Complete IT Band Rehab Health Commons research and land pages

Status: completed
Created: 2026-04-24
Updated: 2026-04-25

## Goal

- Resume the existing IT Band / iliotibial band syndrome rehab research workspace and continue through discovery, reducer, extraction, synthesis, builder, QA, final reducer, and landing.

## Success criteria

- The existing workspace `output-packages/research/it-band-syndrome-rehab-and-return-to-run` reaches a final landing package or records a concrete unrecoverable blocker.
- Missing discovery shards are sent, harvested, and validated without duplicating completed good artifacts.
- Later-stage prompts and command wrappers are materialized from the workspace templates when needed.
- Final Health Commons family, protocol, source, artifact, and generated catalog changes are landed only after the research package is evidence-ready.
- The final protocol keeps diagnosis/referral boundaries conservative and separates direct active rehab evidence from passive modalities, procedure evidence, generic knee pain, and cycling/run-adjacent evidence.
- A scoped commit is created for tracked repo changes unless overlapping dirty work makes that unsafe.

## Scope

- In scope:
  - `output-packages/research/it-band-syndrome-rehab-and-return-to-run/**`
  - `packages/health-commons/content/families/iliotibial-band-syndrome-rehabilitation.md`
  - `packages/health-commons/content/protocols/iliotibial-band-syndrome-rehabilitation/**`
  - `packages/health-commons/content/sources/iliotibial-band-syndrome-rehabilitation/**`
  - `packages/health-commons/content/artifacts/iliotibial-band-syndrome-rehabilitation/**`
  - Directly required generated Health Commons catalog outputs
  - This active plan and its coordination-ledger row
- Out of scope:
  - Individual medical advice or diagnosis
  - Broad Health Commons runtime/tooling work
  - Unrelated Health Commons families, protocols, biomarkers, or UI surfaces
  - Research tooling refactors unless a blocking workflow bug is proven

## Constraints

- Preserve unrelated dirty-tree work.
- Keep generated research files path-relative and avoid local absolute paths or personal identifiers.
- Trust normalized downloaded artifacts over prose logs for artifact-producing seams.
- Do not fabricate source identifiers, effects, sample sizes, safety events, or protocol claims.
- Keep Murph product framing low-burden and evidence-led: this protocol is a bounded self-experiment reference, not a treatment directive.

## Risks and mitigations

1. Risk: ITBS overlaps with other lateral knee or hip conditions.
   Mitigation: Keep differential diagnosis, red flags, stop conditions, and clinician referral boundaries prominent.
2. Risk: The evidence may be weak, mixed, or mostly supervised-clinical.
   Mitigation: Preserve directness labels and avoid translating supervised-only evidence into unsupported home protocol claims.
3. Risk: Active Health Commons runtime work has a broad `packages/health-commons/**` row.
   Mitigation: Keep this lane to content/generated landing for the IT Band package and coordinate before touching shared runtime files.

## Tasks

1. [x] Inspect prior setup outcome and current workspace state.
2. [x] Register this continuation in the coordination ledger.
3. [x] Complete missing discovery shards and validate `source_candidates_v1.json` artifacts.
4. [x] Run snowball and source-ledger reducer.
5. [x] Run source extraction batches.
6. [x] Run section synthesis, page builder, evidence QA, safety QA, and final landing reducer.
7. [x] Land final Health Commons content and generated outputs.
8. [ ] Verify, run required completion workflow, and commit or record the scoped-commit blocker.

## Decisions

- Resume `it-band-syndrome-rehab-and-return-to-run` rather than creating a duplicate IT Band workspace.
- Treat the existing charter boundary as authoritative unless later reducer or QA evidence proves it unsafe.
- Completed discovery shards with valid normalized artifacts should be reused.
- Because larger browser extraction and builder threads stalled or returned non-artifact replies, land from the validated canonical source ledger, reducer metadata, successful section outputs, and conservative metadata-pass source pages. Do not add unextracted sample sizes or effect sizes.

## Verification

- Research seam harvest validation for artifact-producing seams.
- JSON parse/shape checks for normalized research artifacts.
- `pnpm --dir packages/health-commons verify` after landing content/generated outputs.
- `pnpm typecheck`, or a documented scoped alternative if unrelated active branch failures block repo-wide typecheck.
- `git diff --check` on touched tracked files.
Completed: 2026-04-25
