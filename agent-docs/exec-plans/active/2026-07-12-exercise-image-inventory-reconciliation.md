# Complete exercise image inventory reconciliation

Status: active
Created: 2026-07-12
Updated: 2026-07-14

## Goal

- Make PR #561's exercise-image inventory truthful and complete by reconciling all accepted prior catalog work, then generating, validating, uploading, and cataloging every remaining image-less movement.

## Success criteria

- The non-overlapping committed 100-movement batch is reconciled without regenerating its 281 verified public images or overwriting PR #561's 250-movement batch.
- A deterministic post-reconciliation manifest names every remaining image-less movement exactly once and records its owning seed file and movement metadata.
- Every catalog movement has a validated 2–5 slide carousel with public Cloudflare Images delivery URLs; generated details report 1,748 movements with images and zero without images.
- Seed CSVs remain authoritative, generated catalog artifacts are rebuilt only through the exercise-library generator, and no duplicate or non-public image URL is introduced.
- Required exercise-library verification, repository verification, privacy checks, and completion-audit evidence pass on the completed exact head.
- The remaining 343 image-less movements land directly on `main` in six checkpoints of 50 movements and one final checkpoint of 43, with each exact pushed head reconciled and verified before the next checkpoint.

## Scope

- In scope: reconcile commit `8802c1e445b474afb1e6a69b51549089b2ff25eb`; inventory every remaining empty `Images` row; generate and visually validate missing carousels; upload and verify public delivery variants; update only seed `Images` fields; regenerate catalog artifacts; land verified 50-movement checkpoints directly on `main`; and complete final aggregate audits.
- Out of scope: changing exercise definitions, movement prose, IDs, or catalog architecture; replacing already accepted images; bypassing branch protection; modifying unrelated work.

## Constraints

- Preserve unrelated worktrees and the dirty abandoned variant-plan worktree; read it only as historical evidence.
- Follow the Murph exercise-image skill for slide count, subject/camera continuity, limb accuracy, annotations, and full-resolution validation.
- Use the built-in image generator for new raster assets. The user explicitly authorized isolated generation subagents for non-overlapping movement ranges; the controller remains the only seed/catalog writer and uploader, and no subagent receives Cloudflare credentials.
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
7. After the zero-missing checkpoint, run the required aggregate security/privacy, coverage, acceptance, and final-head CI gates before closing the active plan.

## Decisions

- Treat whole-catalog zero-missing coverage as the completion boundary; recovered 100- and 250-row batch sizes are checkpoints, not the product invariant.
- Reuse verified public images from the committed 100-row batch instead of paying generation/upload cost again.
- Keep the historical abandoned variant-plan worktree untouched and move authoritative continuation into the existing PR #561 lane.
- Follow the user's superseding 2026-07-13 delivery route: direct fast-forward pushes to `main` in batches of 50 movements, followed by a final batch of 43. ReviewGPT is PR-only and does not apply to this direct-main route.
- Preserve the seven completed-but-uncommitted recovery handoffs as the first seven movements of batch 1, then continue every other missing movement in ascending manifest sequence.

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
- Completed checkpoint batch 1: recovered seven accepted handoffs with 23 already verified images, then generated or reused 43 direct movements at sequences 10–52 with 143 images. Independent original-resolution review rejected and replaced incorrect limb pairings, movement grips, support-leg changes, and subject/equipment continuity breaks before upload. All 166 images passed deterministic identity preflight, hosted-byte verification, and public delivery checks; only the 50 owning seed `Images` fields changed.
- Completed checkpoint batch 2: generated 50 movements at sequences 53–99 and 125–127 with 115 unique images. A second independent original-resolution review caught and corrected movement-phase, equipment, side-label, and metadata defects across `EX815`, `EX816`, `EX823`, `EX827`, `EX828`, `EX829`, `EX841`, and `EX916`; targeted re-reviews then reported zero remaining findings. All 115 accepted images passed checksum promotion, identity preflight, hosted-original byte verification, and public delivery checks; only the 50 owning seed `Images` fields changed.
- Completed checkpoint batch 3: generated and independently reviewed 50 movements with 155 unique images. Independent original-resolution review caught and corrected side/limb sequencing, subject and equipment continuity, camera locks, movement phases, and false annotation leaders before upload. All 155 accepted images passed checksum promotion, identity preflight, hosted-original byte verification, and public delivery checks; only the 50 owning seed `Images` fields changed.

## Now

- Checkpoint batch 2 is landed on `main` at 1,505 imaged movements, 243 image-less movements, and 4,522 unique public images.
- Batch 3 is landed on `main` at 1,555 imaged movements, 193 image-less movements, and 4,677 unique public images. Its 155 images passed originating and independent review, idempotent upload, hosted-byte verification, public delivery checks, package verification on TypeScript 7, and zero-finding security/privacy and coverage-write audits.
- Batch 4 is the exact next 50 still-empty movements with 184 planned slides after independent review restored a required fourth phase to ST491. Its ignored generation lanes resumed from preserved safe-boundary handoffs after the batch-3 push; the first 28 independently approved carousels (102 images) are uploaded and byte-verified while the catalog remains unchanged.

## Next

- Complete, independently review, upload, catalog, verify, and land batch 4 as the next 50-movement checkpoint.
- Continue the deterministic checkpoints to 1,748 imaged / zero image-less, then run aggregate completion verification and close the active plan with `scripts/finish-task`.

## Verification

- `pnpm --dir packages/exercise-library generate`: passed after reconciliation and alt correction.
- `pnpm --dir packages/exercise-library generate:check`: passed.
- `pnpm --dir packages/exercise-library verify`: passed; 1 test file and 6 tests passed, including exact catalog counts, URL uniqueness, and the 500-character alt bound.
- Current catalog proof: 1,748 total; 1,405 with images; 343 without images; 4,241 images; 4,241 unique public URLs.
- Recovery proof: all seven ready handoff movement records, 23 source checksums, upload identities, public URLs, downloaded public bytes, and ordered seed mappings agree; regeneration passes and reports 1,412 with images, 336 without images, and 4,264 images.
- Batch-1 regenerated catalog proof: 1,748 total movements; 1,455 with images; 293 without images; 4,407 ordered images; 4,407 unique public URLs; zero invalid delivery URLs. `pnpm --dir packages/exercise-library generate:check` passes.
- Batch-1 package verification passes after advancing the exact count guard: typecheck passed, all six tests passed, and deterministic generated-artifact verification passed. Independent coverage/acceptance and security/privacy re-audits report zero remaining findings; all 166 new public image URLs passed range delivery probes.
- Batch-2 regenerated catalog proof: 1,748 total movements; 1,505 with images; 243 without images; 4,522 ordered images; 4,522 unique public URLs; zero invalid delivery URLs. All 115 new images passed hosted-original byte and public-delivery verification. Package verification passed typecheck, all six tests, and deterministic generation; independent coverage/acceptance and security/privacy audits report zero findings.
- Batch-3 regenerated catalog proof: 1,748 total movements; 1,555 with images; 193 without images; 4,677 ordered images; 4,677 unique public URLs; zero invalid or duplicate delivery URLs. Direct diff proof shows exactly 50 formerly empty `Images` cells changed (31 strength-addon and 19 stretch), exactly 155 unique new URLs, and zero non-image-field drift. Package verification on TypeScript 7 passed typecheck, all six tests, and deterministic generation; independent coverage-write and security/privacy audits report zero findings and no edits.
- The latest handoff batch passes `pnpm --dir packages/exercise-library verify`: typecheck, all 6 tests, and deterministic generated-artifact checks are green; seed drift is limited to the 14 intended `Images` fields.
- The subsequent 175/200-range batch also passes `pnpm --dir packages/exercise-library verify`; seed drift is limited to nine intended `Images` fields across two owning seed files, and 4,172 public URLs are unique.
- Remaining generation, upload, full repository verification, completion audits, and final-head CI are pending.
- The controller-ready handoff batch passes `pnpm --dir packages/exercise-library verify`: typecheck, all 6 tests, and deterministic generated-artifact checks are green.
- Sequence 6 also passes `pnpm --dir packages/exercise-library verify`; direct drift proof shows only `EX654.images` changed, with 4,105 unique valid public URLs and no invalid alt records.
