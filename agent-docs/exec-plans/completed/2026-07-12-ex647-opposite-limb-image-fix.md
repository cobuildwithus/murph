# Correct EX647 opposite-limb images

Status: completed
Created: 2026-07-12
Updated: 2026-07-12

## Goal

- Replace EX647's two incorrect movement images, which both show same-side reaches, with visually verified right-arm/left-leg and left-arm/right-leg dead-bug reaches.

## Success criteria

- Both replacements preserve the established subject, styling, and original high three-quarter camera while visibly pairing limbs across foreground/background depth planes.
- EX647's authoritative seed row and generated catalog reference the corrected public Cloudflare Images variants.
- The exercise-library generator, artifact consistency check, focused tests, and public delivery check pass.
- The separate PR #561 response-media finding is rechecked against the merged head and reported accurately without duplicating already-landed fixes.

## Scope

- In scope: EX647 slides 2 and 4 generation and upload artifacts; the two EX647 seed image URLs; regenerated exercise catalog artifacts; focused catalog runtime proof.
- Out of scope: changing EX647 movement copy, replacing setup/reset slides, altering catalog schemas, or modifying the ongoing full-inventory reconciliation plan.

## Constraints

- Preserve unrelated worktree changes and the existing image-inventory lane.
- Keep generated source PNGs, prompts, manifests, and upload mappings ignored/local; commit only the authoritative seed URLs and generator-owned catalog artifacts.
- Do not accept same-side limb movement, changed camera perspective, missing support limbs, or label/leader mismatches.

## Tasks

1. Inspect and prove both current EX647 movement-frame defects.
2. Generate, inspect, upload, and publicly verify the corrected slides.
3. Update only EX647's slide-2 and slide-4 URLs and regenerate the catalog.
4. Run focused verification and required completion review.
5. Commit, push, and open a corrective PR.

## Verification

- `pnpm --dir packages/exercise-library verify` — passed (typecheck, 6 tests, generated-artifact consistency).
- The required `coverage-write` pass added a focused runtime assertion for EX647's ordered four-image sequence, pinning both corrected movement URLs and the unchanged setup/reset URLs; the package verification above passed after that addition.
- `pnpm test:diff packages/exercise-library/content/seed/at-home-exercise-stretch-addon-500.csv packages/exercise-library/generated/exercise-details.json` — the exercise-library owner typecheck passed, then the broader lane stopped before tests on unrelated pre-existing `packages/cli` missing-workspace-module build errors; no CLI file is in this diff.
- `python3 artifacts/exercise-replacement-images/batch-100-2026-07-09/catalog_batch.py audit` — passed (100 accepted sets, 281 accepted slides, 281 upload mappings).
- `python3 artifacts/exercise-replacement-images/batch-100-2026-07-09/catalog_batch.py verify-delivery` — passed (281/281 public variants reachable).
- Independent visual inspection confirmed slide 2 pairs the foreground right arm with the background left leg and slide 4 pairs the background left arm with the foreground right leg, with four traceable limbs in each frame.
- The merged PR #561 response-media report is no longer active: all catalog image alt text satisfies the existing 500-character runtime assertion, and EX725's two-image catalog result normalized unchanged through `normalizeAssistantResponseMediaList` (2 input, 2 output; alt lengths 244 and 120).
Completed: 2026-07-12
