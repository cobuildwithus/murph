# Control-Plane Bundle Hygiene

## Goal

Prevent source/review bundles from packaging ignored local `apps/web/.env` secrets and Next.js build artifacts while preserving the existing repo-level tracked-artifact CI behavior.

## Scope

- Verify whether the reported control-plane exposure is committed to git or only present in the working tree.
- Add a bundle-specific guard that refuses to package working-tree `.env`, `.env.*`, `.next`, `.test-dist`, `dist`, and `*.tsbuildinfo` artifacts.
- Keep the existing `pnpm no-js` tracked-artifact semantics for repo hygiene/CI.
- Document that raw filesystem archives of a clone are unsafe when local control-plane secrets or build output exist.

## Constraints

- Do not delete or rotate local developer secrets from this clone.
- Do not change hosted runtime token escrow, Prisma schema, or auth behavior in this slice.
- Avoid false positives for normal local development by keeping working-tree artifact checks on the source-bundle path rather than the general repo test path.

## Verification Plan

- Add focused unit coverage for the new bundle-artifact detection helpers.
- Run targeted script tests plus the required repo checks as far as the current worktree allows.
- Record whether any required command is blocked by unrelated pre-existing failures.
