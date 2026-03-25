# Control-Plane Bundle Hygiene

## Goal

Prevent source/review bundles from packaging ignored local `apps/web/.env` secrets and build artifacts while preserving the existing repo-level tracked-artifact CI behavior and without forcing operators to clean local build output before `pnpm review:gpt`.

## Scope

- Replace the current raw-working-tree source-bundle gate with a sanitized bundle manifest that stages git-visible files only and still excludes blocked artifact paths.
- Keep the existing `pnpm no-js` tracked-artifact semantics for repo hygiene/CI.
- Preserve inclusion of new untracked non-ignored source files in review bundles.
- Prune untracked generated source sidecars such as `src/*.js` and `src/*.d.ts` before `review:gpt` packages the source bundle.
- Document that raw filesystem archives of a clone remain unsafe even though the guarded source-bundle path now filters ignored local residue.

## Constraints

- Do not delete or rotate local developer secrets from this clone.
- Do not change hosted runtime token escrow, Prisma schema, or auth behavior in this slice.
- Avoid false positives for normal local development by excluding ignored local residue from the source-bundle manifest instead of requiring a clean worktree.
- Keep the package-script CLI and output format compatible with `cobuild-review-gpt`.
- Keep package publish/build outputs under `dist/` or another generated-only path; do not paper over leaked source-side artifacts in the review guard.

## Verification Plan

- Add focused regression coverage for the sanitized source-bundle path.
- Run targeted script tests plus the required repo checks as far as the current worktree allows.
- Record whether any required command is blocked by unrelated pre-existing failures.
Status: completed
Updated: 2026-03-26
Completed: 2026-03-26
