# Land 250 exercise and stretch image sets

Status: completed
Created: 2026-07-10
Updated: 2026-07-11

## Goal

- Generate, validate, upload, and catalog 250 previously missing exercise or stretch image carousels so Murph users can see the new instructional visuals.

## Success criteria

- The frozen batch selection contains exactly 250 unique catalog movements that had no images when selected.
- Every selected movement has a manifest-accepted 2–5 slide carousel that passes the batch validator and Murph exercise-image visual QA.
- Every accepted slide has exactly one persisted Cloudflare Images public delivery mapping, with no duplicate source keys.
- The owning exercise seed CSV rows reference the uploaded public URLs with human-readable step labels and alt text.
- Exercise-library generation/checks, required repo tests/typecheck, privacy scan, completion audits, and a scoped commit all pass.

## Scope

- In scope: resume the existing ignored batch workspace under `artifacts/exercise-replacement-images/batch-250-2026-07-10/**`; finish lanes A–F; upload validated slides; merge upload mappings into the exercise seed CSVs; regenerate and verify the catalog; complete audits and commit.
- Out of scope: replacing existing catalog images, changing exercise definitions beyond the final `Images` field, adding new generation infrastructure, or broad refactors of the exercise library.

## Constraints

- Technical constraints: follow `.agents/skills/murph-exercise-images/SKILL.md`; preserve each lane's subject/camera/style lock; use 2–5 slides based on movement complexity; require full-resolution QA before manifest acceptance; make uploads idempotent by source key; never commit image binaries, temporary paths, signed URLs, or generated provider residue.
- Product/process constraints: default to the smallest existing pipeline; preserve unrelated working-tree changes; do not expose secrets or direct identifiers; do not signal processes not proven to belong to this session; use nested generation subagents as requested; run the required verification and completion workflow before handoff.

## Risks and mitigations

1. Risk: anatomy, limb laterality, annotations, or camera perspective drift while generating at scale.
   Mitigation: movement maps, lane-local subject locks, full-resolution inspection, and targeted regeneration before acceptance.
2. Risk: interrupted or concurrent uploads create missing or duplicate Cloudflare objects/mappings.
   Mitigation: treat the persisted upload ledger as authority, validate unique source keys, and reconcile only missing accepted slides.
3. Risk: batch integration overwrites unrelated exercise seed work.
   Mitigation: inspect dirty state first, update only selected rows' `Images` fields through the existing catalog helper, and review the scoped diff before commit.

## Tasks

1. Reconstruct and validate the recovered batch checkpoint, manifests, selection, upload ledger, and active uploader state.
2. Finish the remaining lane movements with nested generation workers and continuous manifest/upload validation.
3. Run final visual/sample QA and prove exactly 250 valid accepted sets with complete upload mappings.
4. Apply public delivery URLs to the owning seed CSV rows and regenerate the exercise catalog.
5. Run required direct checks, tests/typecheck, security/privacy and coverage audits, parent final review, and privacy-safe diff inspection.
6. Close this plan and create the scoped final commit with `scripts/finish-task`.

## Decisions

- Resume the existing six-lane batch rather than selecting or regenerating completed work.
- Keep the ignored artifact pipeline as temporary execution state; only catalog source changes, the completed plan, and the scoped ledger removal belong in the final commit.
- Leave the recovered uploader running while it remains healthy; its process predates this session and must not be signaled.

## Verification

- Commands to run: batch `progress` and `validate_batch.py`; upload-ledger uniqueness/completeness checks; representative full-resolution image inspection; `pnpm --dir packages/exercise-library generate`; `pnpm --dir packages/exercise-library generate:check`; truthful exercise-library/package diff verification; root typecheck/tests required by the routed task; `git diff --check`; privacy/secret/path scans; required completion audit passes.
- Expected outcomes: 250/250 accepted movements, zero validator issues, all accepted slides uploaded exactly once, catalog rows contain only public Cloudflare delivery URLs, generated catalog agrees with seeds, tests/typecheck pass, and no direct identifiers or secret material appear in the final diff.
Completed: 2026-07-11
