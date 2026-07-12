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
- Keep this lane as the sole canonical branch/seed/catalog writer and uploader. Direct generation ranges are 3–99, 125–149, and 250 onward; skip reserved sequences 100–124 and 150–249 unless consuming completed isolated handoffs, and never let preparation lanes edit this worktree or receive Cloudflare credentials.
- Before consuming an isolated handoff, validate its source head and manifest hash against current movement definitions, re-inspect every original at full resolution, verify checksum/dimensions/order/identity, reuse only already verified public mappings, upload pending originals idempotently in this lane, and record and skip any invalid movement while continuing the next valid item.
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
- Completed manifest sequence 1 (`EX649`, Hollow Body Scissor): reduced the heuristic plan to two distinct frames after full-resolution QA rejected a vertical interpretation and redundant mirrored-cross frames; uploaded two unique public images; updated only the owning seed `Images` field; and rebuilt the catalog to 1,336 imaged movements with 4,054 unique images.
- Completed manifest sequence 2 (`EX650`, Hollow Body Tuck Rock): validated three distinct tuck/rock positions, rejected three anatomically or stylistically incorrect backward-rock drafts, uploaded three full-resolution accepted images, updated only the owning seed `Images` field, and rebuilt the catalog to 1,337 imaged movements with 4,057 unique images.
- Completed manifest sequence 3 (`EX651`, Side Plank Threaded Knee Drive): validated a three-frame fixed-support knee-drive sequence, uploaded three full-resolution accepted images, updated only the owning seed `Images` field, and rebuilt the catalog to 1,338 imaged movements with 4,060 unique images.
- Completed manifest sequence 4 (`EX652`, Side Plank Top-Leg March): reduced the plan to two nonredundant setup/march frames, uploaded two full-resolution accepted images, updated only the owning seed `Images` field, and rebuilt the catalog to 1,339 imaged movements with 4,062 unique images.
- Completed manifest sequence 5 (`EX653`, Side Plank Hip Dip from Knees): reduced the plan to two nonredundant lifted/dip frames, uploaded two full-resolution accepted images, updated only the owning seed `Images` field, and rebuilt the catalog to 1,340 imaged movements with 4,064 unique images.
- Consumed the controller-ready handoff batch for sequences 100–102, 150–155, 175–177, and 200: revalidated 38 hosted or local originals at full resolution, reused 11 exact public mappings, uploaded 27 pending originals with metadata identity preflight, verified hosted original bytes and public variants, and changed only the 13 owning seed `Images` fields. The rebuilt catalog now has 1,353 imaged movements and 4,102 unique images.
- Rejected handoff sequence 156 (`EX965`, Mini-Band Fast Feet) without uploading it because slide 3 changes the subject and entire outfit from slides 1–2; the exact blocker is persisted in the ignored recovery state and the canonical manifest item remains pending.
- Consumed 14 additional validated movements from the 150–174 handoff: sequences 158, 160, 162–165, and 167–174 contributed 34 newly uploaded, hosted-byte-verified, publicly delivered images. Only the 14 owning seed `Images` fields changed, and the handoff file remained byte-identical.
- Rejected handoff sequences 157, 159, 161, and 166 without upload because they respectively break full-body camera continuity, fail to depict the labeled alternating foot position, omit the standing endpoint, and fail to show the required hand-to-hand pass. Each exact blocker is persisted in the ignored recovery state and its canonical manifest item remains pending.
- Consumed nine additional validated handoff movements at sequences 178, 181, 185, 202, 205, 207–209, and 211: uploaded and verified 30 images, updated only the nine owning `Images` fields across the strength-addon and stretch seeds, and preserved stable handoff/snapshot hashes.
- Rejected ten visually invalid handoff sequences (179, 182–184, 201, 203–204, 206, 210, and 212) for opposite-limb, resistance-direction, arm-switch, equipment-count, laterality, or support-continuity failures. Also persisted the explicit incomplete sequence 180 and wrong-pose sequence 186 blockers; all remain pending without uploads.
- Consumed the stopped 200-range tail at sequences 213–215: validated, uploaded, and publicly verified 11 images for three movements. Rejected unilateral sequence 216 because it does not depict a bilateral heel-to-toe rock, and persisted sequence 217's unsupported stair-edge heel-drop blocker without uploading either invalid movement.
- Completed manifest sequence 6 (`EX654`, Side Plank Star Prep): generated and inspected a three-frame setup, transition, and star endpoint with fixed subject/camera/support continuity; uploaded three images through metadata identity preflight; verified hosted bytes and public variants; and updated only the owning seed `Images` field.
- Completed manifest sequence 7 (`EX655`, Copenhagen Plank Adduction Squeeze): rejected two invalid transition renders before accepting a three-frame knee-supported setup, lifted plank, and bottom-leg adduction squeeze; uploaded the three accepted images with hosted-byte and public-variant proof; and updated only the owning seed `Images` field.
- Completed manifest sequence 8 (`EX656`, Forearm Plank Knee-to-Elbow): rejected one overlapped-foot setup, then accepted a three-frame fixed-camera forearm-plank setup, same-side knee transition, and knee-near-elbow endpoint; uploaded and verified three images and updated only the owning seed `Images` field.
- Completed manifest sequence 9 (`EX657`, High Plank Knee-to-Same-Elbow): accepted a three-frame fixed-camera palm-supported setup, same-side knee transition, and knee-near-elbow endpoint; uploaded and verified three images and updated only the owning seed `Images` field.
- Consumed newly completed handoff sequences 103–113: revalidated the source head, current canonical identities, 28 original checksums and dimensions, ordering, full-resolution anatomy, equipment, and continuity; uploaded each image through idempotent identity preflight; verified hosted bytes and public delivery; and updated only the 11 owning seed `Images` fields. Incomplete sequence 114 remains pending and untouched.
- Consumed the completed handoff tail at sequences 114–124 after repeated safe-boundary refreshes: revalidated and uploaded 24 full-resolution suspension-trainer, resistance-band, prone-towel, and loaded-dead-bug images, verified hosted bytes and public variants, and changed only the 11 owning seed `Images` fields. The reserved 100–124 partition is now fully consumed.

## Now

- Valid ready handoff work is consumed through sequences 100–124 and the previously accepted out-of-order ranges through 215, with invalid/incomplete movements left pending; direct sequences 6–9 are cataloged and 343 image-less movements remain.

## Next

- Resume direct generation at manifest sequence 10, preserving all reserved ranges and consuming later corrected or completed handoffs only at safe boundaries.
- Keep ReviewGPT blocked until generation is complete, PR #557 is merged, and the controller grants the single patched 0.5.103 exact-head audit.

## Verification

- `pnpm --dir packages/exercise-library generate`: passed after reconciliation and alt correction.
- `pnpm --dir packages/exercise-library generate:check`: passed.
- `pnpm --dir packages/exercise-library verify`: passed; 1 test file and 6 tests passed, including exact catalog counts, URL uniqueness, and the 500-character alt bound.
- Current catalog proof: 1,748 total; 1,405 with images; 343 without images; 4,241 images; 4,241 unique public URLs.
- The latest handoff batch passes `pnpm --dir packages/exercise-library verify`: typecheck, all 6 tests, and deterministic generated-artifact checks are green; seed drift is limited to the 14 intended `Images` fields.
- The subsequent 175/200-range batch also passes `pnpm --dir packages/exercise-library verify`; seed drift is limited to nine intended `Images` fields across two owning seed files, and 4,172 public URLs are unique.
- Remaining generation, upload, full repository verification, completion audits, and final-head CI are pending.
- The controller-ready handoff batch passes `pnpm --dir packages/exercise-library verify`: typecheck, all 6 tests, and deterministic generated-artifact checks are green.
- Sequence 6 also passes `pnpm --dir packages/exercise-library verify`; direct drift proof shows only `EX654.images` changed, with 4,105 unique valid public URLs and no invalid alt records.
