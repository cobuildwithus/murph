# Complete exercise image inventory reconciliation

Status: active
Created: 2026-07-12
Updated: 2026-07-12

## Goal

- Make PR #561's exercise-image inventory truthful and complete by reconciling all accepted prior catalog work, then generating, validating, uploading, and cataloging every remaining image-less movement.

## Success criteria

- The non-overlapping committed 100-movement batch is reconciled without regenerating its 281 verified public images or overwriting PR #561's 250-movement batch.
- A deterministic post-reconciliation manifest names every remaining image-less movement exactly once and records its owning seed file and movement metadata.
- Every catalog movement has a validated 2–5 slide carousel with public Cloudflare Images delivery URLs; generated details report 1,748 movements with images and zero without images.
- Seed CSVs remain authoritative, generated catalog artifacts are rebuilt only through the exercise-library generator, and no duplicate or non-public image URL is introduced.
- Required exercise-library verification, repository verification, privacy checks, and completion-audit evidence pass on the completed exact head.
- ReviewGPT is not launched until PR #557 is merged and the controller grants one final exact-head audit using the approved 0.5.103 patch.

## Scope

- In scope: reconcile commit `8802c1e445b474afb1e6a69b51549089b2ff25eb`; inventory every remaining empty `Images` row; generate and visually validate missing carousels; upload and verify public delivery variants; update only seed `Images` fields; regenerate catalog artifacts; update PR #561 and hand off final-audit prerequisites.
- Out of scope: changing exercise definitions, movement prose, IDs, or catalog architecture; replacing already accepted images; launching ReviewGPT before the controller gate; modifying PR #557.

## Constraints

- Preserve unrelated worktrees and the dirty abandoned variant-plan worktree; read it only as historical evidence.
- Follow the Murph exercise-image skill for slide count, subject/camera continuity, limb accuracy, annotations, and full-resolution validation.
- Use the built-in image generator for new raster assets and serialize generation in this lane; do not launch child helpers or a CLI/API fallback.
- Keep source PNGs, prompts, QA notes, upload mappings, and reconciliation manifests ignored/local. Commit only authoritative seed URLs, generated catalog artifacts, tests if required, and plan/ledger state.
- Never expose credentials, account identifiers, personal identifiers, local paths, or secret-bearing environment values.

## Risks and mitigations

1. Risk: an earlier partial batch is mistaken for full-catalog completion.
   Mitigation: derive the inventory from the post-reconciliation seed/generated catalog and require zero empty image arrays.
2. Risk: reconciling the prior 100 overwrites newer PR #561 rows.
   Mitigation: assert zero ID overlap, identical non-image fields, and copy only rows whose current `Images` field is empty.
3. Risk: large serial generation drifts anatomically or loses progress.
   Mitigation: persist a deterministic ignored manifest and per-slide acceptance/upload mapping after each movement; regenerate only rejected slides.
4. Risk: uploads duplicate after interruption.
   Mitigation: key upload mappings by manifest movement/slide identity and upload only accepted sources missing a persisted public mapping.

## Tasks

1. Reconcile the verified 100-movement batch into PR #561 and regenerate the catalog.
2. Materialize and validate the exact remaining image-less movement manifest from the combined authoritative seed state.
3. Generate and visually validate every remaining carousel in deterministic order, preserving progress after each accepted movement.
4. Upload accepted slides idempotently, verify public delivery, and apply ordered image records to owning seed rows.
5. Regenerate the catalog and prove 1,748/1,748 movements have images with no invalid or duplicate mappings.
6. Run required tests, typecheck, privacy checks, specialist audits, scoped commit/push, CI, and final-head reconciliation.
7. After PR #557 merges and only with a fresh controller grant, run the single permitted patched 0.5.103 final audit.

## Decisions

- Treat whole-catalog zero-missing coverage as the completion boundary; recovered 100- and 250-row batch sizes are checkpoints, not the product invariant.
- Reuse verified public images from the committed 100-row batch instead of paying generation/upload cost again.
- Keep the historical abandoned variant-plan worktree untouched and move authoritative continuation into the existing PR #561 lane.

## Progress

- Reconciled 100 previously accepted, non-overlapping movements and 281 unique public image URLs from commit `8802c1e445b474afb1e6a69b51549089b2ff25eb`.
- Shortened 23 inherited image alts across 17 movements to satisfy the 500-character response-media contract and added a direct catalog guard.
- Rebuilt the generated catalog: 1,335 of 1,748 movements now have 4,052 unique public images; 413 movements remain image-less.
- Materialized the ignored deterministic recovery manifest: 184 variant exercises, 109 variant stretches, and 120 common stretches; the initial movement-specific slide plan totals 1,294 images pending per-movement validation.
- Preserved the separate dirty historical variant-plan worktree without edits.

## Now

- Hand off the 413-movement manifest for serialized built-in generation, visual QA, idempotent upload, and seed reconciliation.

## Next

- Resume at the first `pending` manifest movement, validate its movement map and slide count, then persist each accepted/uploaded slide before advancing.
- Keep ReviewGPT blocked until generation is complete, PR #557 is merged, and the controller grants the single patched 0.5.103 exact-head audit.

## Verification

- `pnpm --dir packages/exercise-library generate`: passed after reconciliation and alt correction.
- `pnpm --dir packages/exercise-library generate:check`: passed.
- `pnpm --dir packages/exercise-library verify`: passed; 1 test file and 6 tests passed, including exact catalog counts, URL uniqueness, and the 500-character alt bound.
- Direct catalog proof: 1,748 total; 1,335 with images; 413 without images; 4,052 images; 4,052 unique URLs; zero invalid public URLs; zero alts over 500 characters; zero non-image item drift.
- Remaining generation, upload, full repository verification, completion audits, and final-head CI are pending.
