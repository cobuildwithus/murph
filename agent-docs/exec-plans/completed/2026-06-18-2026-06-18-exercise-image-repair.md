# Repair remaining audited exercise image sets

Status: completed
Created: 2026-06-18
Updated: 2026-06-18

## Goal

- Replace the remaining original local raster/SVG-style exercise image URLs from the audit list with acceptable Murph-style hosted Cloudflare Images URLs, without committing image binaries or local paths.

## Success criteria

- The current exercise seed CSVs contain no original audited `removal_decision=remove` image URLs.
- Replacement sets preserve or improve the exercise instruction sequence and use accurate movement poses.
- Finished catalog rows use `Step label | Alt text | https://imagedelivery.net/.../public` entries only.
- `packages/exercise-library/generated/*` is regenerated from seed CSVs, not hand-edited.
- Package generation and verification pass.
- Privacy scan confirms no secrets, local paths, or generated image binaries were committed.

## Scope

- In scope: `packages/exercise-library/content/seed/*.csv`, generated exercise-library catalog artifacts, audit/repair scratch under ignored runtime paths, Cloudflare Images uploads.
- Out of scope: unrelated app/web dirty work, exercise taxonomy redesign, deleting Cloudflare-hosted historical images from the account.

## Constraints

- Technical constraints: do not commit PNG/JPG/WebP binaries; upload finished images and reference public delivery URLs; use the existing generator for catalog JSON.
- Product/process constraints: preserve unrelated worktree edits; keep exercise visuals calm, accurate, annotated, and consistent with Murph exercise image style.

## Risks and mitigations

1. Risk: Replacing a merely ugly image with an inaccurate movement sequence.
   Mitigation: inspect each candidate set against the exercise name, steps, and cue text before accepting it.
2. Risk: Accidentally exposing secrets or local paths while using upload tooling.
   Mitigation: use repo upload helpers, print only sanitized outputs, and run a privacy scan before commit.

## Tasks

1. Recompute the remaining audited remove URLs still present in current seed CSVs.
2. Map each remaining exercise to an existing acceptable replacement set where available.
3. Generate or repair missing sets only when no acceptable candidate exists.
4. Upload accepted images to Cloudflare Images and update seed CSV rows.
5. Regenerate generated catalog artifacts.
6. Run package verification, direct catalog audits, privacy scan, completion audit, and scoped commit.

## Decisions

- Treat all remaining original audited `remove` URLs as in scope even if a previous worker judged a current public set acceptable.

## Verification

- Normal commands: `pnpm --dir packages/exercise-library generate`, `pnpm --dir packages/exercise-library verify`.
- Environment note: `pnpm` was unavailable on the shell PATH, so equivalent package-local entrypoints were run directly with the bundled Node runtime: generator, typecheck, Vitest, and generator check.
- Additional checks: direct audit script confirming zero remaining original remove URLs, scoped privacy/path scan, and `git diff --check`.
- Expected outcomes: all commands pass; no image binaries or local paths appear in the committed diff.
Completed: 2026-06-18
