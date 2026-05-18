# Murph Age Local Scripts Ignore

## Goal

Stop tracking the local `scripts/murph-age/` research scratch corpus in Git while preserving the product Murph Age runtime surfaces under packages.

## Scope

- Add an ignore rule for `scripts/murph-age/`.
- Remove the currently tracked `scripts/murph-age/**` files from the Git index only, leaving local files on disk.
- Exclude `scripts/murph-age/**` from repo tools typecheck and repo-tools Vitest discovery.
- Update durable Murph Age research guidance to make the local-only boundary explicit.

## Constraints

- Preserve unrelated dirty worktree edits.
- Do not delete local Murph Age script files from disk.
- Keep `packages/query`, `packages/health-metrics`, and CLI Murph Age product/runtime code tracked.
- Do not rewrite Git history.

## Verification

- Check for tracked `scripts/murph-age/**` residue.
- Check that references outside `scripts/murph-age` do not depend on the removed tracked scripts.
- Run the required repo verification for this config/docs/tracked-artifact boundary change, or report any unrelated blocker.
Status: completed
Updated: 2026-05-18
Completed: 2026-05-18
